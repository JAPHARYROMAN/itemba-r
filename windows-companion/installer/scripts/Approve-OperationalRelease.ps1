[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CandidatePath,
    [Parameter(Mandatory)][string]$OperationalEvidencePath,
    [Parameter(Mandatory)][string]$OperationalEvidenceSignaturePath,
    [Parameter(Mandatory)][string]$RingEvidencePath,
    [Parameter(Mandatory)][string]$RingEvidenceSignaturePath,
    [Parameter(Mandatory)][string]$ProviderContractAttestationPath,
    [Parameter(Mandatory)][string]$ProviderContractPublicKeyPath,
    [Parameter(Mandatory)][string]$ProviderContractDocumentPath,
    [Parameter(Mandatory)][string]$ExpectedOperationalEvidenceSignerThumbprint,
    [Parameter(Mandatory)][string]$ExpectedRingEvidenceSignerThumbprint,
    [Parameter(Mandatory)][string]$ReleaseSigningCertificateThumbprint
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# SECURITY BOUNDARY: a trusted CI bootstrap, WDAC policy, or equivalent external
# verifier must validate this entry script before it is parsed. These checks
# protect later module loading; they cannot make an already-running script its
# own root of trust.
$embeddedPipelineSignerThumbprint = 'PROVISIONING_REQUIRED'
$embeddedReleasePolicySha256 = '2F58E627B61FF938663A91481E33E485486CE68D120438969F19202FC0BCD8B2'
$installerRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..'))
$policyPath = [IO.Path]::Combine($installerRoot, 'release-policy.json')
$policyBytes = [IO.File]::ReadAllBytes($policyPath)
$policyHasher = [Security.Cryptography.SHA256]::Create()
try {
    $actualReleasePolicySha256 = [BitConverter]::ToString($policyHasher.ComputeHash($policyBytes)).Replace('-', '')
}
finally { $policyHasher.Dispose() }
if ($actualReleasePolicySha256 -cne $embeddedReleasePolicySha256) {
    throw 'release-policy.json differs from the exact digest embedded in this externally signed entry script.'
}

$policy = [Text.Encoding]::UTF8.GetString($policyBytes) | Microsoft.PowerShell.Utility\ConvertFrom-Json
$pinnedPipelineSigner = ([string]$policy.trust.pipelineSignerThumbprint -replace '\s', '').ToUpperInvariant()
$pinnedReleaseSigner = ([string]$policy.trust.releaseSignerThumbprint -replace '\s', '').ToUpperInvariant()
$requestedOperationalSigner = ($ExpectedOperationalEvidenceSignerThumbprint -replace '\s', '').ToUpperInvariant()
$requestedRingSigner = ($ExpectedRingEvidenceSignerThumbprint -replace '\s', '').ToUpperInvariant()
$requestedReleaseSigner = ($ReleaseSigningCertificateThumbprint -replace '\s', '').ToUpperInvariant()
$allowedOperationalSigners = @($policy.trust.allowedOperationalEvidenceSignerThumbprints | ForEach-Object {
    ([string]$_ -replace '\s', '').ToUpperInvariant()
})
$allowedRingSigners = @($policy.trust.allowedRingEvidenceSignerThumbprints | ForEach-Object {
    ([string]$_ -replace '\s', '').ToUpperInvariant()
})
if ($embeddedPipelineSignerThumbprint -notmatch '^[0-9A-F]{40}$' -or
    $pinnedPipelineSigner -cne $embeddedPipelineSignerThumbprint -or
    $pinnedReleaseSigner -notmatch '^[0-9A-F]{40}$') {
    throw 'Protected release-policy.json must pin real pipeline and release signer thumbprints before operational acceptance.'
}
if ($requestedReleaseSigner -ne $pinnedReleaseSigner) {
    throw 'Caller-controlled release signer substitution was refused by protected policy.'
}
if ($requestedOperationalSigner -notin $allowedOperationalSigners -or
    $requestedRingSigner -notin $allowedRingSigners) {
    throw 'Caller-controlled operational/ring signer substitution was refused by protected policy.'
}
if (@(@($pinnedPipelineSigner, $pinnedReleaseSigner, $requestedOperationalSigner, $requestedRingSigner) |
        Select-Object -Unique).Count -ne 4) {
    throw 'Pipeline, release, operational-evidence, and ring-evidence identities must be distinct.'
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
finally { $moduleReadLock.Dispose() }

Assert-WindowsReleaseHost
Assert-TrustedPipelineScript -Path $PSCommandPath -ExpectedThumbprint $pinnedPipelineSigner
Assert-TrustedPipelineScript -Path $modulePath -ExpectedThumbprint $pinnedPipelineSigner
$releaseCertificate = Get-ExactSigningCertificate -Thumbprint (Normalize-Thumbprint -Thumbprint $pinnedReleaseSigner)

function Assert-ExactPropertySet {
    param(
        [Parameter(Mandatory)]$Object,
        [Parameter(Mandatory)][string[]]$Expected,
        [Parameter(Mandatory)][string]$Description
    )
    if ($null -eq $Object) { throw "$Description is missing." }
    $actual = @($Object.PSObject.Properties.Name | Sort-Object)
    $wanted = @($Expected | Sort-Object)
    if (($actual -join '|') -cne ($wanted -join '|')) {
        throw "$Description has a missing or unreviewed property set. Expected $($wanted -join ','); found $($actual -join ',')."
    }
}

function ConvertFrom-ReleaseJson {
    param([Parameter(Mandatory)][string]$Json)
    $converter = Get-Command Microsoft.PowerShell.Utility\ConvertFrom-Json -ErrorAction Stop
    if ($converter.Parameters.ContainsKey('DateKind')) {
        return $Json | Microsoft.PowerShell.Utility\ConvertFrom-Json -DateKind String
    }
    return $Json | Microsoft.PowerShell.Utility\ConvertFrom-Json
}

function Assert-Sha256 {
    param([Parameter(Mandatory)][string]$Value, [Parameter(Mandatory)][string]$Description)
    if ($Value -cnotmatch '^[0-9a-f]{64}$') { throw "$Description must be canonical lowercase SHA-256." }
}

function Assert-CanonicalGuid {
    param([Parameter(Mandatory)][string]$Value, [Parameter(Mandatory)][string]$Description)
    $parsed = [Guid]::Empty
    if (-not [Guid]::TryParseExact($Value, 'D', [ref]$parsed) -or
        $parsed -eq [Guid]::Empty -or $parsed.ToString('D') -cne $Value) {
        throw "$Description must be a non-empty canonical lowercase GUID."
    }
}

function Get-CanonicalProviderTimestamp {
    param([Parameter(Mandatory)][string]$Value, [Parameter(Mandatory)][string]$Description)
    $parsed = [DateTimeOffset]::MinValue
    $styles = [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal
    if (-not [DateTimeOffset]::TryParseExact(
            $Value,
            "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
            [Globalization.CultureInfo]::InvariantCulture,
            $styles,
            [ref]$parsed) -or
        $parsed.ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", [Globalization.CultureInfo]::InvariantCulture) -cne $Value) {
        throw "$Description must be an exact millisecond UTC ISO-8601 instant."
    }
    return $parsed.ToUniversalTime()
}

function Assert-ExactProviderStringArray {
    param(
        [Parameter(Mandatory)]$Value,
        [Parameter(Mandatory)][string]$Description,
        [Parameter(Mandatory)][int]$MinimumCount,
        [Parameter(Mandatory)][int]$MaximumCount,
        [string[]]$ExactValues
    )
    if ($Value -isnot [Array]) { throw "$Description must be a JSON array." }
    $items = @($Value)
    if ($items.Count -lt $MinimumCount -or $items.Count -gt $MaximumCount) {
        throw "$Description has invalid cardinality."
    }
    $validated = [Collections.Generic.List[string]]::new()
    foreach ($item in $items) {
        if ($item -isnot [string]) { throw "$Description must contain only JSON strings." }
        $text = [string]$item
        if ([string]::IsNullOrWhiteSpace($text) -or $text.Length -gt 200 -or
            $text -cnotmatch '^[A-Za-z0-9._:@/-]+$') {
            throw "$Description contains an invalid value."
        }
        $validated.Add($text)
    }
    $sorted = $validated.ToArray()
    [Array]::Sort($sorted, [StringComparer]::Ordinal)
    $uniqueValues = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($item in $sorted) { [void]$uniqueValues.Add($item) }
    if ($uniqueValues.Count -ne $validated.Count -or
        ($validated -join '|') -cne ($sorted -join '|')) {
        throw "$Description must be ordinally sorted and contain no duplicates."
    }
    if ($ExactValues -and ($validated -join '|') -cne ($ExactValues -join '|')) {
        throw "$Description does not equal the exact reviewed set."
    }
    return @($validated)
}

function Assert-ProviderContractBindingShape {
    param([Parameter(Mandatory)]$Binding)
    Assert-ExactPropertySet -Object $Binding -Expected @(
        'contract', 'attestationArtifactSha256', 'publicKeyArtifactSha256',
        'signerSpkiSha256', 'contractDocumentSha256', 'attestationId', 'keyId',
        'signatureAlgorithm', 'provider', 'apiOrigin', 'apiAccountId',
        'apiCredentialKeyId',
        'permittedModelIds', 'coveredDataClasses', 'zeroTraining',
        'providerRetentionSeconds', 'immutableLegalReference', 'issuedAt',
        'effectiveAt', 'expiresAt'
    ) -Description 'provider-contract binding'
    foreach ($stringProperty in @(
        'contract', 'attestationArtifactSha256', 'publicKeyArtifactSha256',
        'signerSpkiSha256', 'contractDocumentSha256', 'attestationId', 'keyId',
        'signatureAlgorithm', 'provider', 'apiOrigin', 'apiAccountId',
        'apiCredentialKeyId',
        'immutableLegalReference', 'issuedAt', 'effectiveAt', 'expiresAt'
    )) {
        if ($Binding.$stringProperty -isnot [string]) {
            throw "Provider-contract binding.$stringProperty must be a JSON string."
        }
    }
    if ($Binding.zeroTraining -isnot [bool] -or
        ($Binding.providerRetentionSeconds -isnot [int] -and
         $Binding.providerRetentionSeconds -isnot [long])) {
        throw 'Provider-contract zeroTraining and providerRetentionSeconds have invalid JSON types.'
    }
    foreach ($property in @(
        'attestationArtifactSha256', 'publicKeyArtifactSha256',
        'signerSpkiSha256', 'contractDocumentSha256'
    )) {
        Assert-Sha256 -Value ([string]$Binding.$property) -Description "provider-contract binding.$property"
    }
    $providerArtifactDigests = @(
        [string]$Binding.attestationArtifactSha256,
        [string]$Binding.publicKeyArtifactSha256,
        [string]$Binding.contractDocumentSha256
    )
    if (@($providerArtifactDigests | Select-Object -Unique).Count -ne 3) {
        throw 'Provider attestation, public key, and contract document must be three distinct byte artifacts.'
    }
    if ([string]$Binding.contract -cne 'msaidizi-provider-contract-attestation/v2' -or
        [string]$Binding.signatureAlgorithm -cne 'ES256' -or
        [string]$Binding.provider -cne 'anthropic' -or
        [string]$Binding.apiOrigin -cne 'https://api.anthropic.com' -or
        $Binding.zeroTraining -ne $true -or [int]$Binding.providerRetentionSeconds -ne 0) {
        throw 'Provider-contract binding has an unsupported protocol, signer algorithm, provider, API origin, training, or retention claim.'
    }
    if ([string]$Binding.attestationId -cnotmatch '^[A-Za-z0-9._:-]{1,128}$' -or
        [string]$Binding.keyId -cnotmatch '^[A-Za-z0-9._:-]{1,128}$' -or
        [string]$Binding.apiAccountId -cnotmatch '^[A-Za-z0-9._:@/-]{1,256}$' -or
        [string]$Binding.apiCredentialKeyId -cnotmatch '^[A-Za-z0-9._:@/-]{1,256}$') {
        throw 'Provider-contract binding contains an invalid attestation, signing-key, API-account, or credential-key identifier.'
    }
    $models = Assert-ExactProviderStringArray -Value $Binding.permittedModelIds `
        -Description 'provider-contract permittedModelIds' -MinimumCount 1 -MaximumCount 16
    $requiredDataClasses = @(
        'audio', 'browser_sessions', 'business_records', 'clipboard', 'credentials',
        'documents', 'email', 'financial_data', 'personal_data', 'screenshots'
    )
    $dataClasses = Assert-ExactProviderStringArray -Value $Binding.coveredDataClasses `
        -Description 'provider-contract coveredDataClasses' -MinimumCount 10 -MaximumCount 10 `
        -ExactValues $requiredDataClasses
    if ([string]$Binding.immutableLegalReference -cne "urn:sha256:$([string]$Binding.contractDocumentSha256)") {
        throw 'Provider immutableLegalReference must exactly content-address the bound contract-document bytes.'
    }
    [void](Get-CanonicalProviderTimestamp -Value ([string]$Binding.issuedAt) -Description 'provider-contract issuedAt')
    [void](Get-CanonicalProviderTimestamp -Value ([string]$Binding.effectiveAt) -Description 'provider-contract effectiveAt')
    [void](Get-CanonicalProviderTimestamp -Value ([string]$Binding.expiresAt) -Description 'provider-contract expiresAt')
    return [pscustomobject]@{ Models = @($models); DataClasses = @($dataClasses) }
}

function Assert-ProviderContractVerificationResult {
    param(
        [Parameter(Mandatory)]$Result,
        [Parameter(Mandatory)]$Binding,
        [Parameter(Mandatory)][DateTimeOffset]$RequiredWindowStart,
        [Parameter(Mandatory)][DateTimeOffset]$RequiredWindowEnd,
        [Parameter(Mandatory)][DateTimeOffset]$VerifiedAt
    )
    Assert-ExactPropertySet -Object $Result -Expected @(
        'schemaVersion', 'status', 'contract', 'keyId', 'signatureAlgorithm',
        'attestationArtifactSha256', 'publicKeyArtifactSha256', 'signerSpkiSha256',
        'contractDocumentSha256', 'attestationId', 'provider', 'apiOrigin',
        'apiAccountId', 'apiCredentialKeyId', 'permittedModelIds', 'coveredDataClasses', 'zeroTraining',
        'providerRetentionSeconds', 'immutableLegalReference', 'issuedAt',
        'effectiveAt', 'expiresAt', 'requiredWindowStartUtc',
        'requiredWindowEndUtc', 'verifiedAtUtc'
    ) -Description 'provider-contract verifier result'
    if ([int]$Result.schemaVersion -ne 2 -or [string]$Result.status -cne 'VERIFIED') {
        throw 'Provider-contract verifier did not return the exact reviewed success protocol.'
    }
    if ($Result.permittedModelIds -isnot [Array] -or
        $Result.coveredDataClasses -isnot [Array] -or
        $Result.zeroTraining -isnot [bool] -or
        ($Result.providerRetentionSeconds -isnot [int] -and
         $Result.providerRetentionSeconds -isnot [long])) {
        throw 'Provider-contract verifier returned invalid JSON types.'
    }
    foreach ($property in @(
        'contract', 'keyId', 'signatureAlgorithm', 'attestationArtifactSha256',
        'publicKeyArtifactSha256', 'signerSpkiSha256', 'contractDocumentSha256',
        'attestationId', 'provider', 'apiOrigin', 'apiAccountId', 'zeroTraining',
        'apiCredentialKeyId',
        'providerRetentionSeconds', 'immutableLegalReference', 'issuedAt',
        'effectiveAt', 'expiresAt'
    )) {
        if ([string]$Result.$property -cne [string]$Binding.$property) {
            throw "Actual provider-contract verification does not match CMS-signed operational evidence ($property)."
        }
    }
    if ((@($Result.permittedModelIds) -join '|') -cne (@($Binding.permittedModelIds) -join '|') -or
        (@($Result.coveredDataClasses) -join '|') -cne (@($Binding.coveredDataClasses) -join '|')) {
        throw 'Actual provider-contract model or data-class scope does not match CMS-signed operational evidence.'
    }
    if ([string]$Result.requiredWindowStartUtc -cne $RequiredWindowStart.ToUniversalTime().ToString('O') -or
        [string]$Result.requiredWindowEndUtc -cne $RequiredWindowEnd.ToUniversalTime().ToString('O') -or
        [string]$Result.verifiedAtUtc -cne $VerifiedAt.ToUniversalTime().ToString('O')) {
        throw 'Provider-contract verifier did not cover the exact operational/ring/approval window.'
    }
}

function Get-FreshTimestamp {
    param(
        [Parameter(Mandatory)][string]$Value,
        [Parameter(Mandatory)][int]$MaximumAgeHours,
        [Parameter(Mandatory)][string]$Description
    )
    $parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParse($Value, [ref]$parsed)) { throw "$Description is not a timestamp." }
    $utc = $parsed.ToUniversalTime()
    $now = [DateTimeOffset]::UtcNow
    if ($utc -gt $now.AddMinutes(5) -or ($now - $utc).TotalHours -gt $MaximumAgeHours) {
        throw "$Description is future-dated or stale."
    }
    return $utc
}

function Assert-ReleaseBinding {
    param([Parameter(Mandatory)]$Binding, [Parameter(Mandatory)]$Expected, [Parameter(Mandatory)][string]$Description)
    Assert-ExactPropertySet -Object $Binding -Expected @(
        'installerVmApprovalSha256', 'releaseManifestSha256', 'version', 'sourceRevision', 'msiSha256'
    ) -Description $Description
    foreach ($property in @('installerVmApprovalSha256', 'releaseManifestSha256', 'msiSha256')) {
        Assert-Sha256 -Value ([string]$Binding.$property) -Description "$Description.$property"
    }
    foreach ($property in @('installerVmApprovalSha256', 'releaseManifestSha256', 'version', 'sourceRevision', 'msiSha256')) {
        if ([string]$Binding.$property -cne [string]$Expected.$property) {
            throw "$Description does not bind to the exact accepted release ($property)."
        }
    }
}

function Assert-ArtifactSet {
    param(
        [Parameter(Mandatory)]$Artifacts,
        [Parameter(Mandatory)][int]$MinimumCount,
        [Parameter(Mandatory)][string]$Description
    )
    $items = @($Artifacts)
    if ($items.Count -lt $MinimumCount) { throw "$Description contains fewer than $MinimumCount immutable artifacts." }
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    $hashes = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($artifact in $items) {
        Assert-ExactPropertySet -Object $artifact -Expected @('name', 'sha256', 'immutableReference') -Description "$Description artifact"
        if ([string]::IsNullOrWhiteSpace([string]$artifact.name) -or
            [string]::IsNullOrWhiteSpace([string]$artifact.immutableReference)) {
            throw "$Description contains an artifact without a name or immutable reference."
        }
        Assert-Sha256 -Value ([string]$artifact.sha256) -Description "$Description artifact SHA-256"
        if (-not $names.Add([string]$artifact.name)) { throw "$Description contains duplicate artifact name $($artifact.name)." }
        [void]$hashes.Add([string]$artifact.sha256)
    }
    return $hashes
}

$candidateRoot = Resolve-ExistingDirectoryPath -Path $CandidatePath -Description 'release candidate'
$manifestPath = Join-Path $candidateRoot 'release-manifest.json'
$manifestSignaturePath = "$manifestPath.p7s"
Assert-DetachedCmsSignature -ContentPath $manifestPath -SignaturePath $manifestSignaturePath -ExpectedThumbprint $pinnedReleaseSigner | Out-Null
$manifest = ConvertFrom-ReleaseJson -Json (
    Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8)
if ($manifest.schemaVersion -ne 1 -or [string]$manifest.status -ne 'AWAITING_SIGNED_DISPOSABLE_VM_ACCEPTANCE' -or
    [string]$manifest.codeSigningThumbprint -ne $pinnedReleaseSigner) {
    throw 'Release manifest is not the exact supported signed candidate.'
}
Assert-ManifestInventory -Root $candidateRoot -Manifest $manifest
$manifestSha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()

$installerApprovalPath = Join-Path $candidateRoot 'installer-vm-accepted.json'
$installerApprovalSignaturePath = "$installerApprovalPath.p7s"
Assert-DetachedCmsSignature -ContentPath $installerApprovalPath -SignaturePath $installerApprovalSignaturePath -ExpectedThumbprint $pinnedReleaseSigner | Out-Null
$installerApproval = ConvertFrom-ReleaseJson -Json (
    Get-Content -LiteralPath $installerApprovalPath -Raw -Encoding utf8)
if ($installerApproval.schemaVersion -ne 1 -or
    [string]$installerApproval.status -ne 'INSTALLER_VM_ACCEPTED_AWAITING_OPERATIONAL_COMPANION_ACCEPTANCE' -or
    $installerApproval.productionDeploymentEligible -or
    [string]$installerApproval.gates.operationalCompanionAcceptance -ne 'NOT_EXECUTED' -or
    [string]$installerApproval.gates.productionRingAcceptance -ne 'NOT_EXECUTED') {
    throw 'Installer approval is missing, ambiguous, or already claims operational/production acceptance.'
}
$installerApprovalSha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $installerApprovalPath -Algorithm SHA256).Hash.ToLowerInvariant()
if ([string]$installerApproval.releaseManifestSha256 -ne $manifestSha256 -or
    [string]$installerApproval.version -ne [string]$manifest.version -or
    [string]$installerApproval.sourceRevision -ne [string]$manifest.sourceRevision -or
    [string]$installerApproval.msiSha256 -ne ([string]$manifest.msi.sha256).ToLowerInvariant()) {
    throw 'Installer approval does not bind to the exact signed release manifest.'
}
$allowedCandidateFiles = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($entry in @($manifest.files)) { [void]$allowedCandidateFiles.Add([string]$entry.path) }
foreach ($relative in @(
    'release-manifest.json', 'release-manifest.json.p7s',
    'installer-vm-accepted.json', 'installer-vm-accepted.json.p7s'
)) { [void]$allowedCandidateFiles.Add($relative) }
$actualCandidateFiles = @(Get-ChildItem -LiteralPath $candidateRoot -Recurse -File | ForEach-Object {
    $_.FullName.Substring($candidateRoot.Length + 1).Replace('\', '/')
})
if ($actualCandidateFiles.Count -ne $allowedCandidateFiles.Count) {
    throw 'Candidate contains missing or unreviewed files after installer approval.'
}
foreach ($relative in $actualCandidateFiles) {
    if (-not $allowedCandidateFiles.Contains($relative)) {
        throw "Candidate contains an unreviewed file after installer approval: $relative"
    }
}
$providerContractVerifierFile = Resolve-ExistingLeafPath `
    -Path (Join-Path $candidateRoot 'support\ProviderContractVerifier\Itemba.Msaidizi.ProviderContractVerifier.exe') `
    -Description 'release-bound provider-contract verifier'
$providerContractAttestationFile = Resolve-ExistingLeafPath `
    -Path $ProviderContractAttestationPath -Description 'provider-contract attestation artifact'
$providerContractPublicKeyFile = Resolve-ExistingLeafPath `
    -Path $ProviderContractPublicKeyPath -Description 'provider-contract public key artifact'
$providerContractDocumentFile = Resolve-ExistingLeafPath `
    -Path $ProviderContractDocumentPath -Description 'provider contract document artifact'
$releaseBinding = [pscustomobject]@{
    installerVmApprovalSha256 = $installerApprovalSha256
    releaseManifestSha256 = $manifestSha256
    version = [string]$manifest.version
    sourceRevision = [string]$manifest.sourceRevision
    msiSha256 = ([string]$manifest.msi.sha256).ToLowerInvariant()
}

$operationalEvidenceFile = Resolve-ExistingLeafPath -Path $OperationalEvidencePath -Description 'operational acceptance evidence'
$operationalSignatureFile = Resolve-ExistingLeafPath -Path $OperationalEvidenceSignaturePath -Description 'operational acceptance signature'
Assert-DetachedCmsSignature -ContentPath $operationalEvidenceFile -SignaturePath $operationalSignatureFile -ExpectedThumbprint $requestedOperationalSigner | Out-Null
$operational = ConvertFrom-ReleaseJson -Json (
    Get-Content -LiteralPath $operationalEvidenceFile -Raw -Encoding utf8)
Assert-ExactPropertySet -Object $operational -Expected @(
    'schemaVersion', 'status', 'evidenceScope', 'productionDeploymentEligible',
    'acceptanceRunId', 'completedAtUtc', 'signerThumbprint', 'release', 'providerContract', 'devices',
    'checks', 'counters', 'noSkippedChecks', 'artifacts'
) -Description 'operational evidence'
if ($operational.schemaVersion -ne 1 -or
    [string]$operational.status -ne 'PASS_AWAITING_RING_ACCEPTANCE' -or
    [string]$operational.evidenceScope -ne 'FULL_COMPANION_OPERATIONAL_ACCEPTANCE' -or
    $operational.productionDeploymentEligible -or -not $operational.noSkippedChecks -or
    [string]$operational.signerThumbprint -cne $requestedOperationalSigner) {
    throw 'Operational evidence does not represent a complete, unskipped, non-production pass.'
}
Assert-CanonicalGuid -Value ([string]$operational.acceptanceRunId) -Description 'operational acceptanceRunId'
$operationalCompleted = Get-FreshTimestamp -Value ([string]$operational.completedAtUtc) `
    -MaximumAgeHours ([int]$policy.maximumOperationalEvidenceAgeHours) -Description 'operational completion'
Assert-ReleaseBinding -Binding $operational.release -Expected $releaseBinding -Description 'operational release binding'
$operationalArtifactHashes = Assert-ArtifactSet -Artifacts $operational.artifacts -MinimumCount 18 -Description 'operational evidence'
$providerContractSets = Assert-ProviderContractBindingShape -Binding $operational.providerContract
foreach ($providerArtifactProperty in @(
    'attestationArtifactSha256', 'publicKeyArtifactSha256', 'contractDocumentSha256'
)) {
    if (-not $operationalArtifactHashes.Contains([string]$operational.providerContract.$providerArtifactProperty)) {
        throw "Provider-contract $providerArtifactProperty is not backed by a declared immutable artifact."
    }
}

$devices = @($operational.devices)
if ($devices.Count -lt 1) { throw 'Operational evidence must contain at least one enrolled device.' }
$deviceIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$enrollmentIds = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$deviceIdentities = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($device in $devices) {
    Assert-ExactPropertySet -Object $device -Expected @(
        'deviceId', 'enrollmentId', 'deviceIdentitySha256', 'tpmAttestationSha256',
        'osBuild', 'architecture', 'fileSystem', 'status'
    ) -Description 'operational device'
    Assert-CanonicalGuid -Value ([string]$device.deviceId) -Description 'deviceId'
    Assert-CanonicalGuid -Value ([string]$device.enrollmentId) -Description 'enrollmentId'
    Assert-Sha256 -Value ([string]$device.deviceIdentitySha256) -Description 'device identity SHA-256'
    Assert-Sha256 -Value ([string]$device.tpmAttestationSha256) -Description 'TPM attestation SHA-256'
    if (-not $operationalArtifactHashes.Contains([string]$device.tpmAttestationSha256)) {
        throw 'An enrolled device TPM attestation is not backed by a declared immutable artifact.'
    }
    if ([int]$device.osBuild -lt 22000 -or [string]$device.architecture -ne 'x64' -or
        [string]$device.fileSystem -ne 'NTFS' -or [string]$device.status -ne 'PASS') {
        throw 'Operational evidence contains an unsupported or failed device.'
    }
    if (-not $deviceIds.Add([string]$device.deviceId) -or
        -not $enrollmentIds.Add([string]$device.enrollmentId) -or
        -not $deviceIdentities.Add([string]$device.deviceIdentitySha256)) {
        throw 'Operational evidence contains a duplicate device, enrollment, or hardware identity.'
    }
}

$requiredOperationalChecks = @(
    'device-pairing-and-outbound-mtls',
    'signed-action-token-dispatch-and-ledger-reconciliation',
    'typed-host-and-erp-read-write-mutation-matrix',
    'restart-reconnect-replay-and-idempotency-matrix',
    'pause-cancel-owned-process-tree-and-late-completion-races',
    'unknown-outcome-needs-attention-and-recovery-matrix',
    'kill-switch-and-autopilot-disable-drills',
    'raw-credentials-nonpersistence',
    'prompt-injection-multimodal-boundary',
    'ntfs-adversarial-path-matrix',
    'external-egress-boundary-browser-and-raw-shell',
    'voice-vision-text-governance-parity',
    'provider-zero-training-and-zero-retention-contract',
    'supervisor-self-modification-isolation',
    'autonomous-update-canary-and-rollback'
)
$observedOperationalChecks = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$operationalWindowStarted = [DateTimeOffset]::MaxValue
$providerContractCheck = $null
foreach ($check in @($operational.checks)) {
    Assert-ExactPropertySet -Object $check -Expected @('id', 'status', 'startedAtUtc', 'completedAtUtc', 'artifactSha256') -Description 'operational check'
    $checkId = [string]$check.id
    if ($checkId -notin $requiredOperationalChecks -or -not $observedOperationalChecks.Add($checkId) -or
        [string]$check.status -ne 'PASS') {
        throw "Operational evidence contains an unknown, duplicate, or failed check: $checkId"
    }
    $checkStarted = [DateTimeOffset]::Parse([string]$check.startedAtUtc).ToUniversalTime()
    $checkCompleted = [DateTimeOffset]::Parse([string]$check.completedAtUtc).ToUniversalTime()
    if ($checkCompleted -lt $checkStarted -or $checkCompleted -gt $operationalCompleted) {
        throw "Operational check has an invalid execution window: $checkId"
    }
    if ($checkStarted -lt $operationalWindowStarted) { $operationalWindowStarted = $checkStarted }
    Assert-Sha256 -Value ([string]$check.artifactSha256) -Description "operational check $checkId artifact"
    if (-not $operationalArtifactHashes.Contains([string]$check.artifactSha256)) {
        throw "Operational check is not backed by a declared immutable artifact: $checkId"
    }
    if ($checkId -ceq 'provider-zero-training-and-zero-retention-contract') {
        $providerContractCheck = $check
    }
}
if ($observedOperationalChecks.Count -ne $requiredOperationalChecks.Count) {
    throw 'Operational evidence check set is incomplete.'
}
if ($null -eq $providerContractCheck -or
    [string]$providerContractCheck.artifactSha256 -cne [string]$operational.providerContract.attestationArtifactSha256) {
    throw 'Provider-contract operational check must bind the exact signed attestation bytes.'
}
$requiredOperationalCounters = @(
    'duplicateMutations', 'duplicateExternalActions', 'unknownWritesAutomaticallyRetried',
    'lateCompletionsOverwritingCancellation', 'journalLedgerReconciliationMismatches',
    'credentialPersistenceFindings', 'unplannedPromptInjectionSteps',
    'dispatchesAfterKillSwitch', 'unrecoveredReversibleActions'
)
Assert-ExactPropertySet -Object $operational.counters -Expected $requiredOperationalCounters -Description 'operational counters'
foreach ($counter in $requiredOperationalCounters) {
    if ([long]$operational.counters.$counter -ne 0) { throw "Operational failure counter is non-zero: $counter" }
}
$operationalSha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $operationalEvidenceFile -Algorithm SHA256).Hash.ToLowerInvariant()

$ringEvidenceFile = Resolve-ExistingLeafPath -Path $RingEvidencePath -Description 'ring acceptance evidence'
$ringSignatureFile = Resolve-ExistingLeafPath -Path $RingEvidenceSignaturePath -Description 'ring acceptance signature'
Assert-DetachedCmsSignature -ContentPath $ringEvidenceFile -SignaturePath $ringSignatureFile -ExpectedThumbprint $requestedRingSigner | Out-Null
$ringEvidence = ConvertFrom-ReleaseJson -Json (
    Get-Content -LiteralPath $ringEvidenceFile -Raw -Encoding utf8)
Assert-ExactPropertySet -Object $ringEvidence -Expected @(
    'schemaVersion', 'status', 'productionDeploymentEligible', 'acceptanceRunId',
    'completedAtUtc', 'signerThumbprint', 'operationalEvidenceSha256', 'release',
    'rings', 'noSkippedChecks', 'artifacts'
) -Description 'ring evidence'
if ($ringEvidence.schemaVersion -ne 1 -or [string]$ringEvidence.status -ne 'PASS' -or
    -not $ringEvidence.productionDeploymentEligible -or -not $ringEvidence.noSkippedChecks -or
    [string]$ringEvidence.signerThumbprint -cne $requestedRingSigner -or
    [string]$ringEvidence.operationalEvidenceSha256 -cne $operationalSha256) {
    throw 'Ring evidence is incomplete, skipped, unbound, or not a production-eligible pass.'
}
Assert-CanonicalGuid -Value ([string]$ringEvidence.acceptanceRunId) -Description 'ring acceptanceRunId'
$ringCompleted = Get-FreshTimestamp -Value ([string]$ringEvidence.completedAtUtc) `
    -MaximumAgeHours ([int]$policy.maximumRingEvidenceAgeHours) -Description 'ring completion'
if ($ringCompleted -lt $operationalCompleted) { throw 'Ring acceptance completed before operational acceptance.' }
Assert-ReleaseBinding -Binding $ringEvidence.release -Expected $releaseBinding -Description 'ring release binding'
$ringArtifactHashes = Assert-ArtifactSet -Artifacts $ringEvidence.artifacts -MinimumCount 36 -Description 'ring evidence'

$requiredRingChecks = @(
    'rollout-health', 'audit-ledger-reconciliation', 'recovery-drill', 'central-kill-switch',
    'device-kill-switch', 'global-autopilot-disable', 'autonomous-update-rollback',
    'no-duplicate-mutation-or-external-action'
)
$requiredRingCounters = @(
    'failedDevices', 'unhealthyDevices', 'reconciliationMismatches',
    'dispatchesAfterKillSwitch', 'rollbackFailures', 'duplicateMutations',
    'duplicateExternalActions'
)
$ringNames = @('RING_0', 'RING_5', 'RING_25', 'RING_100')
$ringPercents = @(0, 5, 25, 100)
$rings = @($ringEvidence.rings)
if ($rings.Count -ne 4) { throw 'Ring evidence must contain exactly ring 0, 5%, 25%, and 100%.' }
$previousCompleted = $operationalCompleted
$previousPopulation = 0
for ($index = 0; $index -lt 4; $index++) {
    $ring = $rings[$index]
    Assert-ExactPropertySet -Object $ring -Expected @(
        'name', 'sequence', 'targetPercent', 'status', 'enrolledPopulation',
        'targetedDeviceCount', 'observedHealthyDeviceCount', 'targetDeviceSetSha256',
        'startedAtUtc', 'completedAtUtc', 'observedHealthHours', 'checks', 'counters'
    ) -Description "ring $index"
    if ([string]$ring.name -cne $ringNames[$index] -or [int]$ring.sequence -ne $index -or
        [int]$ring.targetPercent -ne $ringPercents[$index] -or [string]$ring.status -ne 'PASS') {
        throw "Ring sequence is missing, reordered, or failed at index $index."
    }
    $population = [int]$ring.enrolledPopulation
    $targeted = [int]$ring.targetedDeviceCount
    $healthy = [int]$ring.observedHealthyDeviceCount
    if ($population -lt 1 -or $population -lt $previousPopulation) {
        throw "Enrolled population is invalid or decreased at $($ring.name)."
    }
    $expectedTarget = if ($index -eq 0) { 1 } else {
        [Math]::Max(1, [int][Math]::Ceiling($population * $ringPercents[$index] / 100.0))
    }
    if ($targeted -ne $expectedTarget -or $healthy -ne $targeted) {
        throw "Ring target or healthy-device count is not exact for $($ring.name)."
    }
    Assert-Sha256 -Value ([string]$ring.targetDeviceSetSha256) -Description "$($ring.name) target device set"
    if (-not $ringArtifactHashes.Contains([string]$ring.targetDeviceSetSha256)) {
        throw "Ring target device set is not backed by a declared immutable artifact: $($ring.name)"
    }
    $ringStarted = [DateTimeOffset]::Parse([string]$ring.startedAtUtc).ToUniversalTime()
    $ringEnded = [DateTimeOffset]::Parse([string]$ring.completedAtUtc).ToUniversalTime()
    if ($ringStarted -lt $previousCompleted -or $ringEnded -lt $ringStarted -or $ringEnded -gt $ringCompleted) {
        throw "Ring timing is overlapping, reversed, or outside the signed evidence window: $($ring.name)"
    }
    $minimumHealth = [double]$policy.minimumRingHealthHours.($ringNames[$index])
    $actualHealth = [double]$ring.observedHealthHours
    if ($minimumHealth -le 0 -or $actualHealth -lt $minimumHealth -or
        ($ringEnded - $ringStarted).TotalHours + 0.01 -lt $actualHealth) {
        throw "Ring health window is insufficient or inconsistent for $($ring.name)."
    }
    $observedRingChecks = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($check in @($ring.checks)) {
        Assert-ExactPropertySet -Object $check -Expected @('id', 'status', 'artifactSha256') -Description "$($ring.name) check"
        $checkId = [string]$check.id
        if ($checkId -notin $requiredRingChecks -or -not $observedRingChecks.Add($checkId) -or
            [string]$check.status -ne 'PASS') {
            throw "Ring evidence contains an unknown, duplicate, or failed check: $($ring.name)/$checkId"
        }
        Assert-Sha256 -Value ([string]$check.artifactSha256) -Description "$($ring.name)/$checkId artifact"
        if (-not $ringArtifactHashes.Contains([string]$check.artifactSha256)) {
            throw "Ring check is not backed by a declared immutable artifact: $($ring.name)/$checkId"
        }
    }
    if ($observedRingChecks.Count -ne $requiredRingChecks.Count) {
        throw "Ring check set is incomplete for $($ring.name)."
    }
    Assert-ExactPropertySet -Object $ring.counters -Expected $requiredRingCounters -Description "$($ring.name) counters"
    foreach ($counter in $requiredRingCounters) {
        if ([long]$ring.counters.$counter -ne 0) { throw "Ring failure counter is non-zero: $($ring.name)/$counter" }
    }
    $previousCompleted = $ringEnded
    $previousPopulation = $population
}

$approvalNow = [DateTimeOffset]::UtcNow
if ($approvalNow -lt $ringCompleted -or $operationalWindowStarted -eq [DateTimeOffset]::MaxValue) {
    throw 'Provider-contract verification window could not be bound to completed operational and ring evidence.'
}
$providerVerifierRelativePath = 'support/ProviderContractVerifier/Itemba.Msaidizi.ProviderContractVerifier.exe'
$providerVerifierManifestEntries = @($manifest.files | Where-Object {
    [string]$_.path -ceq $providerVerifierRelativePath
})
if ($providerVerifierManifestEntries.Count -ne 1) {
    throw 'Signed release manifest must contain exactly one reviewed provider-contract verifier executable.'
}
$providerVerifierManifestEntry = $providerVerifierManifestEntries[0]
$providerVerifierReadLock = [IO.File]::Open(
    $providerContractVerifierFile, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
    $providerVerifierHasher = [Security.Cryptography.SHA256]::Create()
    try {
        $lockedProviderVerifierSha256 = [BitConverter]::ToString(
            $providerVerifierHasher.ComputeHash($providerVerifierReadLock)).Replace('-', '').ToLowerInvariant()
    }
    finally { $providerVerifierHasher.Dispose() }
    $providerVerifierReadLock.Position = 0
    if ([long]$providerVerifierManifestEntry.size -ne $providerVerifierReadLock.Length -or
        [string]$providerVerifierManifestEntry.sha256 -cne $lockedProviderVerifierSha256) {
        throw 'Locked provider-contract verifier bytes do not match the signed release manifest.'
    }
    $providerVerifierOutput = @(& $providerContractVerifierFile `
        '--attestation' $providerContractAttestationFile `
        '--public-key' $providerContractPublicKeyFile `
        '--contract-document' $providerContractDocumentFile `
        '--required-window-start-utc' $operationalWindowStarted.ToUniversalTime().ToString('O') `
        '--required-window-end-utc' $approvalNow.ToUniversalTime().ToString('O') `
        '--validation-time-utc' $approvalNow.ToUniversalTime().ToString('O') 2>&1)
    $providerVerifierExitCode = $LASTEXITCODE
}
finally { $providerVerifierReadLock.Dispose() }
if ($providerVerifierExitCode -ne 0) {
    throw "Release-bound provider-contract verifier refused the actual artifacts: $($providerVerifierOutput -join [Environment]::NewLine)"
}
try {
    $providerVerification = ConvertFrom-ReleaseJson -Json (
        $providerVerifierOutput -join [Environment]::NewLine)
}
catch {
    throw 'Release-bound provider-contract verifier returned malformed output.'
}
Assert-ProviderContractVerificationResult -Result $providerVerification `
    -Binding $operational.providerContract -RequiredWindowStart $operationalWindowStarted `
    -RequiredWindowEnd $approvalNow -VerifiedAt $approvalNow

$productionApprovalPath = Join-Path $candidateRoot 'production-accepted.json'
$productionApprovalSignaturePath = "$productionApprovalPath.p7s"
if ((Test-Path -LiteralPath $productionApprovalPath) -or (Test-Path -LiteralPath $productionApprovalSignaturePath)) {
    throw 'Refusing to overwrite an existing production acceptance record.'
}
$now = $approvalNow
$productionApproval = [ordered]@{
    schemaVersion = 1
    status = 'PRODUCTION_OPERATIONAL_AND_RING_ACCEPTED'
    productionDeploymentEligible = $true
    approvedAtUtc = $now.ToString('O')
    release = [ordered]@{
        installerVmApprovalSha256 = $installerApprovalSha256
        releaseManifestSha256 = $manifestSha256
        version = [string]$manifest.version
        sourceRevision = [string]$manifest.sourceRevision
        msiSha256 = ([string]$manifest.msi.sha256).ToLowerInvariant()
    }
    operationalEvidence = [ordered]@{
        sha256 = $operationalSha256
        signerThumbprint = $requestedOperationalSigner
        acceptanceRunId = [string]$operational.acceptanceRunId
        completedAtUtc = $operationalCompleted.ToString('O')
    }
    providerContract = [ordered]@{
        contract = [string]$providerVerification.contract
        attestationArtifactSha256 = [string]$providerVerification.attestationArtifactSha256
        publicKeyArtifactSha256 = [string]$providerVerification.publicKeyArtifactSha256
        signerSpkiSha256 = [string]$providerVerification.signerSpkiSha256
        contractDocumentSha256 = [string]$providerVerification.contractDocumentSha256
        attestationId = [string]$providerVerification.attestationId
        keyId = [string]$providerVerification.keyId
        signatureAlgorithm = [string]$providerVerification.signatureAlgorithm
        provider = [string]$providerVerification.provider
        apiOrigin = [string]$providerVerification.apiOrigin
        apiAccountId = [string]$providerVerification.apiAccountId
        apiCredentialKeyId = [string]$providerVerification.apiCredentialKeyId
        permittedModelIds = @($providerVerification.permittedModelIds)
        coveredDataClasses = @($providerVerification.coveredDataClasses)
        zeroTraining = [bool]$providerVerification.zeroTraining
        providerRetentionSeconds = [int]$providerVerification.providerRetentionSeconds
        immutableLegalReference = [string]$providerVerification.immutableLegalReference
        issuedAt = [string]$providerVerification.issuedAt
        effectiveAt = [string]$providerVerification.effectiveAt
        expiresAt = [string]$providerVerification.expiresAt
        requiredWindowStartUtc = [string]$providerVerification.requiredWindowStartUtc
        requiredWindowEndUtc = [string]$providerVerification.requiredWindowEndUtc
        verifiedAtUtc = [string]$providerVerification.verifiedAtUtc
    }
    ringEvidence = [ordered]@{
        sha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $ringEvidenceFile -Algorithm SHA256).Hash.ToLowerInvariant()
        signerThumbprint = $requestedRingSigner
        acceptanceRunId = [string]$ringEvidence.acceptanceRunId
        completedAtUtc = $ringCompleted.ToString('O')
    }
    gates = [ordered]@{
        installerVmAcceptance = 'PASS'
        externalVmDisposition = 'PASS'
        operationalCompanionAcceptance = 'PASS'
        productionRingAcceptance = 'PASS'
        exactReleaseBinding = $true
        independentEvidenceSigners = $true
        noSkippedChecks = $true
        allFailureCountersZero = $true
        immutableArtifactsBound = $true
        providerContractCryptographicallyVerified = $true
        providerContractCoversOperationalAndRingWindow = $true
    }
}
$productionApproval | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $productionApprovalPath -Encoding utf8
New-DetachedCmsSignature -ContentPath $productionApprovalPath -Certificate $releaseCertificate -SignaturePath $productionApprovalSignaturePath
Assert-DetachedCmsSignature -ContentPath $productionApprovalPath -SignaturePath $productionApprovalSignaturePath -ExpectedThumbprint $pinnedReleaseSigner | Out-Null

Write-Host "Operational and ring acceptance recorded: $candidateRoot"
Write-Host 'The signed record is release-specific; deployment control must still enforce device enrollment and global kill switches.'
[pscustomobject]@{
    CandidatePath = $candidateRoot
    ApprovalPath = $productionApprovalPath
    Status = 'PRODUCTION_OPERATIONAL_AND_RING_ACCEPTED'
    ProductionDeploymentEligible = $true
}
