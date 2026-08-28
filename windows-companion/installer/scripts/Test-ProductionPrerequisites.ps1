[CmdletBinding()]
param(
    [ValidateSet('All', 'BuildHost', 'VmHost', 'Operational', 'Rollout')]
    [string[]]$Scope = @('All'),
    [string]$ReleasePolicyPath = (Join-Path $PSScriptRoot '..\release-policy.json'),
    [string]$DotNetPath,
    [string]$SignToolPath,
    [string]$SbomToolPath,
    [string]$DefenderCommandPath,
    [string]$TimestampUri,
    [string]$SigningKeyAttestationPath,
    [string]$VmOrchestratorPath,
    [string]$VmOrchestratorSignerThumbprint,
    [string]$VmTemplateEvidencePath,
    [string]$ProviderContractVerifierPath,
    [string]$ProviderContractAttestationPath,
    [string]$ProviderContractPublicKeyPath,
    [string]$ProviderContractDocumentPath,
    [string]$EgressBoundaryDeploymentEvidencePath,
    [string]$EgressBoundaryDeploymentEvidenceSignaturePath,
    [string]$EgressBoundaryDeploymentEvidenceSignerThumbprint,
    [string]$TrustedRootIsolationEvidencePath,
    [string]$TrustedRootIsolationEvidenceSignaturePath,
    [string]$TrustedRootIsolationEvidenceSignerThumbprint,
    [string]$DeviceEnrollmentEvidencePath,
    [string]$InstallerVmApprovalPath,
    [string]$InstallerVmApprovalSignaturePath,
    [string]$OperationalEvidencePath,
    [string]$OperationalEvidenceSignaturePath,
    [string]$RingEvidencePath,
    [string]$RingEvidenceSignaturePath,
    [string]$ProductionAcceptancePath,
    [string]$ProductionAcceptanceSignaturePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# This is a read-only, non-authoritative inventory. It may show that inputs are
# present, but only the externally trusted signed release and acceptance gates
# may declare a production deployment eligible.
$installerRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$companionRoot = [IO.Path]::GetFullPath((Join-Path $installerRoot '..'))
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $companionRoot '..'))
$maximumInventoryArtifactBytes = 67108864
$checks = [Collections.Generic.List[object]]::new()
$selectedScopes = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($requestedScope in $Scope) {
    if ($requestedScope -ceq 'All') {
        foreach ($expandedScope in @('BuildHost', 'VmHost', 'Operational', 'Rollout')) {
            [void]$selectedScopes.Add($expandedScope)
        }
    }
    else {
        [void]$selectedScopes.Add($requestedScope)
    }
}

function Test-ScopeSelected {
    param([Parameter(Mandatory)][string]$Name)
    return $selectedScopes.Contains($Name)
}

function Add-ReadinessCheck {
    param(
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][string]$ScopeName,
        [Parameter(Mandatory)][bool]$Passed,
        [Parameter(Mandatory)][string]$ReasonCode,
        [Collections.IDictionary]$Evidence = ([ordered]@{})
    )

    $checks.Add([pscustomobject][ordered]@{
        id = $Id
        scope = $ScopeName
        status = if ($Passed) { 'PASS' } else { 'BLOCKED' }
        reasonCode = $ReasonCode
        evidence = [pscustomobject]$Evidence
    })
}

function Get-ReleasePolicyProvisioningState {
    param([Parameter(Mandatory)]$Policy)

    $placeholder = 'PROVISIONING_REQUIRED'
    try {
        $dotnetHash = [string]$Policy.dotnetHostSha256
        $sbomHash = [string]$Policy.sbomToolSha256
        $pipelineSigner = [string]$Policy.trust.pipelineSignerThumbprint
        $releaseSigner = [string]$Policy.trust.releaseSignerThumbprint
        $allowlistNames = @(
            'allowedVmEvidenceSignerThumbprints',
            'allowedVmOrchestratorSignerThumbprints',
            'allowedOperationalEvidenceSignerThumbprints',
            'allowedRingEvidenceSignerThumbprints'
        )
        $allowlists = [Collections.Generic.List[object[]]]::new()
        foreach ($allowlistName in $allowlistNames) {
            $value = $Policy.trust.$allowlistName
            if ($null -eq $value -or $value -is [string] -or $value -isnot [Collections.IEnumerable]) {
                return 'INVALID'
            }
            $allowlists.Add(@($value))
        }

        $isUnprovisioned = $dotnetHash -ceq $placeholder -and
            $sbomHash -ceq $placeholder -and
            $pipelineSigner -ceq $placeholder -and
            $releaseSigner -ceq $placeholder -and
            @($allowlists | Where-Object { $_.Count -ne 0 }).Count -eq 0
        if ($isUnprovisioned) { return 'UNPROVISIONED' }

        if ($dotnetHash -cnotmatch '^[0-9A-Fa-f]{64}$' -or
            $sbomHash -cnotmatch '^[0-9A-Fa-f]{64}$' -or
            $pipelineSigner -cnotmatch '^[0-9A-Fa-f]{40}$' -or
            $releaseSigner -cnotmatch '^[0-9A-Fa-f]{40}$' -or
            @($allowlists | Where-Object { $_.Count -eq 0 }).Count -ne 0) {
            return 'INVALID'
        }

        $allSigners = [Collections.Generic.List[string]]::new()
        $allSigners.Add($pipelineSigner.ToUpperInvariant())
        $allSigners.Add($releaseSigner.ToUpperInvariant())
        foreach ($allowlist in $allowlists) {
            foreach ($signer in $allowlist) {
                $signerText = [string]$signer
                if ($signerText -cnotmatch '^[0-9A-Fa-f]{40}$') { return 'INVALID' }
                $allSigners.Add($signerText.ToUpperInvariant())
            }
        }
        if (@($allSigners | Select-Object -Unique).Count -ne $allSigners.Count) {
            return 'INVALID'
        }
        return 'PROVISIONED'
    }
    catch {
        return 'INVALID'
    }
}

function Get-ArtifactProbe {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return [pscustomobject]@{ Present = $false; ReasonCode = 'artifact_not_supplied'; Evidence = [ordered]@{}; ResolvedPath = $null }
    }
    $fileProbe = Get-CanonicalLocalFileProbe -Path $Path -MaximumBytes $maximumInventoryArtifactBytes
    if (-not $fileProbe.Passed) {
        return [pscustomobject]@{ Present = $false; ReasonCode = $fileProbe.ReasonCode; Evidence = [ordered]@{}; ResolvedPath = $null }
    }
    try {
        $item = $fileProbe.Item
        $digest = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256 -ErrorAction Stop).Hash.ToLowerInvariant()
        return [pscustomobject]@{
            Present = $true
            ReasonCode = 'artifact_present_unverified'
            ResolvedPath = $item.FullName
            Evidence = [ordered]@{
                sha256 = $digest
                bytes = [long]$item.Length
                validationLevel = 'presence_and_digest_only'
            }
        }
    }
    catch {
        return [pscustomobject]@{ Present = $false; ReasonCode = 'artifact_unreadable'; Evidence = [ordered]@{}; ResolvedPath = $null }
    }
}

function Get-CanonicalLocalFileProbe {
    param(
        [string]$Path,
        [long]$MaximumBytes = [long]::MaxValue
    )

    if ([string]::IsNullOrWhiteSpace($Path) -or
        -not [IO.Path]::IsPathFullyQualified($Path) -or
        $Path.StartsWith('\\', [StringComparison]::Ordinal) -or
        $Path.StartsWith('\\?\', [StringComparison]::Ordinal) -or
        $Path.StartsWith('\\.\', [StringComparison]::Ordinal)) {
        return [pscustomobject]@{ Passed = $false; ReasonCode = 'artifact_path_not_canonical_local'; Item = $null }
    }
    try {
        $fullPath = [IO.Path]::GetFullPath($Path)
        $volumeRoot = [IO.Path]::GetPathRoot($fullPath)
        if ([string]::IsNullOrWhiteSpace($volumeRoot) -or
            $volumeRoot.StartsWith('\\', [StringComparison]::Ordinal)) {
            return [pscustomobject]@{ Passed = $false; ReasonCode = 'artifact_path_not_canonical_local'; Item = $null }
        }
        $relative = $fullPath.Substring($volumeRoot.Length)
        if ($relative.Contains(':')) {
            return [pscustomobject]@{ Passed = $false; ReasonCode = 'artifact_path_contains_alternate_data_stream'; Item = $null }
        }

        $current = $volumeRoot
        $segments = @($relative.Split(
            [char[]]@([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar),
            [StringSplitOptions]::RemoveEmptyEntries))
        foreach ($segment in $segments) {
            $current = Join-Path $current $segment
            $component = Get-Item -LiteralPath $current -Force -ErrorAction Stop
            if (($component.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                return [pscustomobject]@{ Passed = $false; ReasonCode = 'artifact_path_contains_reparse_point'; Item = $null }
            }
        }
        $item = Get-Item -LiteralPath $fullPath -Force -ErrorAction Stop
        if ($item.PSIsContainer -or $item.Length -le 0) {
            return [pscustomobject]@{ Passed = $false; ReasonCode = 'artifact_not_a_nonempty_file'; Item = $null }
        }
        if ($item.Length -gt $MaximumBytes) {
            return [pscustomobject]@{ Passed = $false; ReasonCode = 'artifact_too_large'; Item = $null }
        }
        return [pscustomobject]@{ Passed = $true; ReasonCode = 'canonical_local_file'; Item = $item }
    }
    catch {
        return [pscustomobject]@{ Passed = $false; ReasonCode = 'artifact_unreadable'; Item = $null }
    }
}

function Add-ArtifactAvailabilityCheck {
    param(
        [Parameter(Mandatory)][string]$Id,
        [Parameter(Mandatory)][string]$ScopeName,
        [string]$Path
    )

    $probe = Get-ArtifactProbe -Path $Path
    Add-ReadinessCheck -Id $Id -ScopeName $ScopeName -Passed $probe.Present `
        -ReasonCode $probe.ReasonCode -Evidence $probe.Evidence
    return $probe
}

function Test-MicrosoftSignedFile {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) {
        return [pscustomobject]@{ Passed = $false; ReasonCode = 'tool_path_not_supplied'; Evidence = [ordered]@{} }
    }
    $fileProbe = Get-CanonicalLocalFileProbe -Path $Path -MaximumBytes $maximumInventoryArtifactBytes
    if (-not $fileProbe.Passed) {
        return [pscustomobject]@{ Passed = $false; ReasonCode = $fileProbe.ReasonCode; Evidence = [ordered]@{} }
    }
    try {
        $item = $fileProbe.Item
        $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $item.FullName -ErrorAction Stop
        if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
            -not $signature.SignerCertificate -or
            $signature.SignerCertificate.Subject -notmatch '(?i)Microsoft') {
            return [pscustomobject]@{ Passed = $false; ReasonCode = 'tool_not_microsoft_authenticode_valid'; Evidence = [ordered]@{} }
        }
        return [pscustomobject]@{
            Passed = $true
            ReasonCode = 'microsoft_authenticode_valid'
            Evidence = [ordered]@{
                sha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                authenticodeValid = $true
                microsoftSigner = $true
            }
        }
    }
    catch {
        return [pscustomobject]@{ Passed = $false; ReasonCode = 'tool_unreadable'; Evidence = [ordered]@{} }
    }
}

function Test-ExactAuthenticodeFile {
    param(
        [string]$Path,
        [string]$ExpectedThumbprint,
        [string[]]$AllowedThumbprints
    )

    $normalizedExpected = ($ExpectedThumbprint -replace '\s', '').ToUpperInvariant()
    $normalizedAllowed = @($AllowedThumbprints | ForEach-Object { ([string]$_ -replace '\s', '').ToUpperInvariant() })
    if ([string]::IsNullOrWhiteSpace($Path) -or
        $normalizedExpected -cnotmatch '^[0-9A-F]{40}$' -or
        $normalizedExpected -notin $normalizedAllowed) {
        return [pscustomobject]@{ Passed = $false; ReasonCode = 'artifact_or_policy_signer_not_supplied'; Evidence = [ordered]@{} }
    }
    $fileProbe = Get-CanonicalLocalFileProbe -Path $Path -MaximumBytes $maximumInventoryArtifactBytes
    if (-not $fileProbe.Passed) {
        return [pscustomobject]@{ Passed = $false; ReasonCode = $fileProbe.ReasonCode; Evidence = [ordered]@{} }
    }
    try {
        $item = $fileProbe.Item
        $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $item.FullName -ErrorAction Stop
        $actualThumbprint = if ($signature.SignerCertificate) {
            ($signature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant()
        }
        else { '' }
        $passed = $signature.Status -eq [Management.Automation.SignatureStatus]::Valid -and
            $actualThumbprint -ceq $normalizedExpected
        return [pscustomobject]@{
            Passed = $passed
            ReasonCode = if ($passed) { 'authenticode_matches_protected_policy_signer' } else { 'authenticode_invalid_or_signer_mismatch' }
            Evidence = [ordered]@{
                sha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                authenticodeValid = $signature.Status -eq [Management.Automation.SignatureStatus]::Valid
                signerMatchesPolicy = $actualThumbprint -ceq $normalizedExpected
            }
        }
    }
    catch {
        return [pscustomobject]@{ Passed = $false; ReasonCode = 'signed_tool_unreadable'; Evidence = [ordered]@{} }
    }
}

function Get-JsonClaimProbe {
    param(
        [string]$Path,
        [Parameter(Mandatory)][scriptblock]$Predicate
    )

    $artifact = Get-ArtifactProbe -Path $Path
    if (-not $artifact.Present) {
        return [pscustomobject]@{ Passed = $false; ReasonCode = $artifact.ReasonCode; Evidence = $artifact.Evidence }
    }
    try {
        $json = Get-Content -LiteralPath $artifact.ResolvedPath -Raw -Encoding utf8 -ErrorAction Stop |
            Microsoft.PowerShell.Utility\ConvertFrom-Json -Depth 64 -ErrorAction Stop
        $passed = [bool](& $Predicate $json)
        return [pscustomobject]@{
            Passed = $passed
            ReasonCode = if ($passed) { 'claim_shape_present_unverified' } else { 'claim_shape_invalid' }
            Evidence = $artifact.Evidence
        }
    }
    catch {
        return [pscustomobject]@{ Passed = $false; ReasonCode = 'artifact_json_invalid'; Evidence = $artifact.Evidence }
    }
}

function Test-ExactClaimProperties {
    param(
        [Parameter(Mandatory)]$Claim,
        [Parameter(Mandatory)][string[]]$Expected
    )

    $actual = @($Claim.PSObject.Properties.Name | Sort-Object)
    $reviewed = @($Expected | Sort-Object)
    return ($actual -join '|') -ceq ($reviewed -join '|')
}

function Test-FreshEvidenceTime {
    param(
        [string]$ObservedAtUtc,
        [double]$MaximumAgeHours
    )

    $observed = [DateTimeOffset]::MinValue
    if ($MaximumAgeHours -le 0 -or
        -not [DateTimeOffset]::TryParse($ObservedAtUtc, [ref]$observed) -or
        $observed.Offset -ne [TimeSpan]::Zero) {
        return $false
    }
    $now = [DateTimeOffset]::UtcNow
    return $observed -le $now.AddMinutes(5) -and $observed -ge $now.AddHours(-$MaximumAgeHours)
}

function Test-CanonicalNonEmptyGuid {
    param([string]$Value)

    $parsed = [guid]::Empty
    return [guid]::TryParseExact($Value, 'D', [ref]$parsed) -and
        $parsed -ne [guid]::Empty -and
        $parsed.ToString('D') -ceq $Value
}

function Test-DetachedCmsDeploymentEvidence {
    param(
        [string]$ContentPath,
        [string]$SignaturePath,
        [string]$ExpectedThumbprint,
        [string[]]$AllowedThumbprints,
        [Parameter(Mandatory)][scriptblock]$Predicate
    )

    $content = Get-ArtifactProbe -Path $ContentPath
    if (-not $content.Present) {
        return [pscustomobject]@{ Passed = $false; ReasonCode = $content.ReasonCode; Evidence = $content.Evidence }
    }
    $signature = Get-ArtifactProbe -Path $SignaturePath
    if (-not $signature.Present) {
        return [pscustomobject]@{ Passed = $false; ReasonCode = 'deployment_evidence_signature_not_supplied_or_invalid'; Evidence = $content.Evidence }
    }

    $expected = ($ExpectedThumbprint -replace '\s', '').ToUpperInvariant()
    $allowed = @($AllowedThumbprints | ForEach-Object {
        ([string]$_ -replace '\s', '').ToUpperInvariant()
    })
    if ($expected -cnotmatch '^[0-9A-F]{40}$' -or $expected -notin $allowed) {
        return [pscustomobject]@{ Passed = $false; ReasonCode = 'deployment_evidence_signer_not_pinned_by_policy'; Evidence = $content.Evidence }
    }

    try {
        $contentBytes = [IO.File]::ReadAllBytes($content.ResolvedPath)
        $signatureBytes = [IO.File]::ReadAllBytes($signature.ResolvedPath)
        $cms = [Security.Cryptography.Pkcs.SignedCms]::new(
            [Security.Cryptography.Pkcs.ContentInfo]::new($contentBytes),
            $true)
        $cms.Decode($signatureBytes)
        $cms.CheckSignature($false)
        if ($cms.SignerInfos.Count -ne 1 -or -not $cms.SignerInfos[0].Certificate) {
            throw 'invalid signer inventory'
        }
        $actual = ($cms.SignerInfos[0].Certificate.Thumbprint -replace '\s', '').ToUpperInvariant()
        if ($actual -cne $expected) {
            throw 'signer mismatch'
        }
        $claim = [Text.Encoding]::UTF8.GetString($contentBytes) |
            Microsoft.PowerShell.Utility\ConvertFrom-Json -Depth 32 -ErrorAction Stop
        if (-not [bool](& $Predicate $claim)) {
            return [pscustomobject]@{
                Passed = $false
                ReasonCode = 'signed_deployment_evidence_claim_invalid_or_incomplete'
                Evidence = [ordered]@{
                    sha256 = [string]$content.Evidence.sha256
                    signatureSha256 = [string]$signature.Evidence.sha256
                    validationLevel = 'detached_cms_exact_signer_claim_rejected'
                }
            }
        }
        return [pscustomobject]@{
            Passed = $true
            ReasonCode = 'signed_live_deployment_evidence_verified'
            Claim = $claim
            Evidence = [ordered]@{
                sha256 = [string]$content.Evidence.sha256
                signatureSha256 = [string]$signature.Evidence.sha256
                validationLevel = 'detached_cms_exact_policy_signer_and_live_claims'
            }
        }
    }
    catch {
        return [pscustomobject]@{
            Passed = $false
            ReasonCode = 'deployment_evidence_signature_invalid_or_signer_mismatch'
            Evidence = [ordered]@{
                sha256 = [string]$content.Evidence.sha256
                signatureSha256 = [string]$signature.Evidence.sha256
                validationLevel = 'detached_cms_verification_failed'
            }
        }
    }
}

$policy = $null
$policyState = 'INVALID'
$policyHash = $null
try {
    $policyProbe = Get-CanonicalLocalFileProbe -Path $ReleasePolicyPath -MaximumBytes 1048576
    if (-not $policyProbe.Passed) { throw 'invalid' }
    $policyItem = $policyProbe.Item
    $policy = Get-Content -LiteralPath $policyItem.FullName -Raw -Encoding utf8 -ErrorAction Stop |
        Microsoft.PowerShell.Utility\ConvertFrom-Json -ErrorAction Stop
    $policyHash = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $policyItem.FullName -Algorithm SHA256).Hash.ToUpperInvariant()
    $policyState = Get-ReleasePolicyProvisioningState -Policy $policy
    Add-ReadinessCheck -Id 'release_policy_readable' -ScopeName 'BuildHost' -Passed $true `
        -ReasonCode 'release_policy_readable' -Evidence ([ordered]@{ sha256 = $policyHash.ToLowerInvariant() })
}
catch {
    Add-ReadinessCheck -Id 'release_policy_readable' -ScopeName 'BuildHost' -Passed $false `
        -ReasonCode 'release_policy_unreadable'
}

if (Test-ScopeSelected 'BuildHost') {
    $windowsBuild = [Environment]::OSVersion.Version.Build
    $windowsOk = [Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT -and
        $windowsBuild -ge 22000 -and [Environment]::Is64BitOperatingSystem -and [Environment]::Is64BitProcess
    Add-ReadinessCheck -Id 'host_windows_11_x64' -ScopeName 'BuildHost' -Passed $windowsOk `
        -ReasonCode $(if ($windowsOk) { 'windows_11_x64' } else { 'windows_11_x64_required' }) `
        -Evidence ([ordered]@{ build = $windowsBuild; os64Bit = [Environment]::Is64BitOperatingSystem; process64Bit = [Environment]::Is64BitProcess })

    $ntfsOk = $false
    try {
        $programDataRoot = [IO.Path]::GetPathRoot([Environment]::GetFolderPath([Environment+SpecialFolder]::CommonApplicationData))
        $ntfsOk = ([IO.DriveInfo]::new($programDataRoot)).DriveFormat -ceq 'NTFS'
    }
    catch { $ntfsOk = $false }
    Add-ReadinessCheck -Id 'host_programdata_ntfs' -ScopeName 'BuildHost' -Passed $ntfsOk `
        -ReasonCode $(if ($ntfsOk) { 'programdata_volume_ntfs' } else { 'programdata_volume_not_verified_ntfs' })

    $tpmPresent = $false
    $tpmReady = $false
    $tpm20 = $false
    try {
        $tpm = Get-Tpm -ErrorAction Stop
        $tpmCim = Get-CimInstance -Namespace 'root\CIMV2\Security\MicrosoftTpm' -ClassName Win32_Tpm -ErrorAction Stop
        $tpmPresent = [bool]$tpm.TpmPresent
        $tpmReady = [bool]$tpm.TpmReady
        $tpm20 = [string]$tpmCim.SpecVersion -match '(^|,)2\.0(,|$)'
    }
    catch { }
    $tpmOk = $tpmPresent -and $tpmReady -and $tpm20
    Add-ReadinessCheck -Id 'host_tpm_2_ready' -ScopeName 'BuildHost' -Passed $tpmOk `
        -ReasonCode $(if ($tpmOk) { 'tpm_2_present_and_ready' } else { 'tpm_2_not_present_ready_and_attested' }) `
        -Evidence ([ordered]@{ present = $tpmPresent; ready = $tpmReady; specification20 = $tpm20 })

    $secureBoot = $false
    try { $secureBoot = (Confirm-SecureBootUEFI -ErrorAction Stop) -eq $true } catch { }
    Add-ReadinessCheck -Id 'host_secure_boot_enabled' -ScopeName 'BuildHost' -Passed $secureBoot `
        -ReasonCode $(if ($secureBoot) { 'secure_boot_enabled' } else { 'secure_boot_disabled_or_unavailable' })

    $hvci = $false
    try {
        $deviceGuard = Get-CimInstance -Namespace 'root\Microsoft\Windows\DeviceGuard' -ClassName Win32_DeviceGuard -ErrorAction Stop
        $hvci = @($deviceGuard.SecurityServicesRunning) -contains 2
    }
    catch { }
    Add-ReadinessCheck -Id 'host_hvci_running' -ScopeName 'BuildHost' -Passed $hvci `
        -ReasonCode $(if ($hvci) { 'hvci_running' } else { 'hvci_not_running_or_unavailable' })

    $policyProvisioned = $policyState -ceq 'PROVISIONED'
    Add-ReadinessCheck -Id 'release_policy_provisioned' -ScopeName 'BuildHost' -Passed $policyProvisioned `
        -ReasonCode $(if ($policyProvisioned) { 'release_policy_provisioned' } elseif ($policyState -ceq 'UNPROVISIONED') { 'release_policy_unprovisioned' } else { 'release_policy_invalid_or_partial' }) `
        -Evidence ([ordered]@{ provisioningState = $policyState })

    $bindingOk = $false
    if ($null -ne $policy -and $null -ne $policyHash) {
        try {
            $pipelineSigner = ([string]$policy.trust.pipelineSignerThumbprint -replace '\s', '').ToUpperInvariant()
            $entryNames = @('New-SignedReleaseCandidate.ps1', 'Approve-SignedRelease.ps1', 'Approve-OperationalRelease.ps1')
            $bindingOk = $pipelineSigner -match '^[0-9A-F]{40}$'
            foreach ($entryName in $entryNames) {
                $entryText = Get-Content -LiteralPath (Join-Path $PSScriptRoot $entryName) -Raw -Encoding utf8 -ErrorAction Stop
                $bindingOk = $bindingOk -and
                    $entryText.Contains("`$embeddedReleasePolicySha256 = '$policyHash'") -and
                    $entryText.Contains("`$embeddedPipelineSignerThumbprint = '$pipelineSigner'")
            }
        }
        catch { $bindingOk = $false }
    }
    Add-ReadinessCheck -Id 'release_entry_policy_bindings' -ScopeName 'BuildHost' -Passed $bindingOk `
        -ReasonCode $(if ($bindingOk) { 'entry_scripts_bind_exact_policy_and_pipeline_signer' } else { 'entry_script_policy_binding_missing_or_unprovisioned' })

    $signedEntryCount = 0
    $entrySignatureOk = $policyProvisioned
    if ($entrySignatureOk) {
        try {
            $expectedPipelineSigner = ([string]$policy.trust.pipelineSignerThumbprint -replace '\s', '').ToUpperInvariant()
            $signedPaths = @(
                (Join-Path $PSScriptRoot 'New-SignedReleaseCandidate.ps1'),
                (Join-Path $PSScriptRoot 'Approve-SignedRelease.ps1'),
                (Join-Path $PSScriptRoot 'Approve-OperationalRelease.ps1'),
                (Join-Path $PSScriptRoot 'Release.Common.psm1')
            )
            foreach ($signedPath in $signedPaths) {
                $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $signedPath -ErrorAction Stop
                $actualSigner = if ($signature.SignerCertificate) { ($signature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant() } else { '' }
                if ($signature.Status -ne [Management.Automation.SignatureStatus]::Valid -or $actualSigner -cne $expectedPipelineSigner) {
                    $entrySignatureOk = $false
                    break
                }
                $signedEntryCount++
            }
        }
        catch { $entrySignatureOk = $false }
    }
    Add-ReadinessCheck -Id 'release_pipeline_authenticode' -ScopeName 'BuildHost' -Passed $entrySignatureOk `
        -ReasonCode $(if ($entrySignatureOk) { 'pipeline_scripts_authenticode_valid' } else { 'pipeline_scripts_not_authenticode_valid_for_policy_signer' }) `
        -Evidence ([ordered]@{ validatedFileCount = $signedEntryCount; requiredFileCount = 4 })

    $dotnetProbe = Test-MicrosoftSignedFile -Path $DotNetPath
    $dotnetOk = $dotnetProbe.Passed -and $policyProvisioned
    $dotnetVersion = ''
    if ($dotnetOk) {
        try {
            $dotnetOutput = @(& $DotNetPath --version 2>&1 | ForEach-Object { $_.ToString() })
            $dotnetVersion = ($dotnetOutput -join '').Trim()
            $dotnetOk = $LASTEXITCODE -eq 0 -and
                $dotnetVersion -ceq [string]$policy.dotnetSdkVersion -and
                [string]$dotnetProbe.Evidence.sha256 -ceq ([string]$policy.dotnetHostSha256).ToLowerInvariant()
        }
        catch { $dotnetOk = $false }
    }
    Add-ReadinessCheck -Id 'tool_dotnet_pinned' -ScopeName 'BuildHost' -Passed $dotnetOk `
        -ReasonCode $(if ($dotnetOk) { 'dotnet_signature_version_and_hash_match_policy' } elseif (-not $dotnetProbe.Passed) { $dotnetProbe.ReasonCode } else { 'dotnet_policy_binding_failed' }) `
        -Evidence ([ordered]@{ version = $dotnetVersion; hashChecked = $policyProvisioned; authenticodeChecked = $dotnetProbe.Passed })

    $signToolProbe = Test-MicrosoftSignedFile -Path $SignToolPath
    Add-ReadinessCheck -Id 'tool_signtool_microsoft_signed' -ScopeName 'BuildHost' -Passed $signToolProbe.Passed `
        -ReasonCode $signToolProbe.ReasonCode -Evidence $signToolProbe.Evidence

    $sbomProbe = Test-MicrosoftSignedFile -Path $SbomToolPath
    $sbomOk = $sbomProbe.Passed -and $policyProvisioned
    $sbomVersionMatched = $false
    if ($sbomOk) {
        try {
            $sbomOutput = @(& $SbomToolPath --version 2>&1 | ForEach-Object { $_.ToString() })
            $sbomVersionMatched = $LASTEXITCODE -eq 0 -and (($sbomOutput -join "`n") -match '(?<![0-9])4\.1\.5(?![0-9])')
            $sbomOk = $sbomVersionMatched -and
                [string]$sbomProbe.Evidence.sha256 -ceq ([string]$policy.sbomToolSha256).ToLowerInvariant()
        }
        catch { $sbomOk = $false }
    }
    Add-ReadinessCheck -Id 'tool_sbom_pinned' -ScopeName 'BuildHost' -Passed $sbomOk `
        -ReasonCode $(if ($sbomOk) { 'sbom_signature_version_and_hash_match_policy' } elseif (-not $sbomProbe.Passed) { $sbomProbe.ReasonCode } else { 'sbom_policy_binding_failed' }) `
        -Evidence ([ordered]@{ versionMatched = $sbomVersionMatched; hashChecked = $policyProvisioned; authenticodeChecked = $sbomProbe.Passed })

    $defenderTool = Test-MicrosoftSignedFile -Path $DefenderCommandPath
    $defenderEnabled = $false
    $defenderFresh = $false
    $defenderAgeHours = $null
    if ($defenderTool.Passed -and $null -ne $policy) {
        try {
            $defender = Get-MpComputerStatus -ErrorAction Stop
            $defenderEnabled = [bool]$defender.AntivirusEnabled -and [bool]$defender.AMServiceEnabled -and [bool]$defender.RealTimeProtectionEnabled
            $defenderAgeHours = [math]::Round(([DateTimeOffset]::UtcNow - [DateTimeOffset]$defender.AntivirusSignatureLastUpdated).TotalHours, 2)
            $defenderFresh = $defenderAgeHours -ge 0 -and $defenderAgeHours -le [double]$policy.maximumDefenderSignatureAgeHours
        }
        catch { }
    }
    $defenderOk = $defenderTool.Passed -and $defenderEnabled -and $defenderFresh
    Add-ReadinessCheck -Id 'tool_defender_ready' -ScopeName 'BuildHost' -Passed $defenderOk `
        -ReasonCode $(if ($defenderOk) { 'defender_enabled_and_fresh' } elseif (-not $defenderTool.Passed) { $defenderTool.ReasonCode } else { 'defender_disabled_or_signatures_stale' }) `
        -Evidence ([ordered]@{ enabled = $defenderEnabled; signaturesFresh = $defenderFresh; signatureAgeHours = $defenderAgeHours })

    $certificateOk = $false
    $certificateMatches = 0
    if ($policyProvisioned) {
        try {
            $releaseThumbprint = ([string]$policy.trust.releaseSignerThumbprint -replace '\s', '').ToUpperInvariant()
            $matches = @(
                Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -CodeSigningCert -ErrorAction SilentlyContinue |
                    Where-Object { ($_.Thumbprint -replace '\s', '').ToUpperInvariant() -ceq $releaseThumbprint }
            )
            $certificateMatches = $matches.Count
            if ($matches.Count -eq 1) {
                $certificate = $matches[0]
                $now = [DateTimeOffset]::UtcNow
                $certificateOk = $certificate.HasPrivateKey -and
                    $certificate.NotBefore.ToUniversalTime() -le $now.UtcDateTime -and
                    $certificate.NotAfter.ToUniversalTime() -gt $now.UtcDateTime -and
                    ($certificate.EnhancedKeyUsageList.ObjectId.Value -contains '1.3.6.1.5.5.7.3.3')
            }
        }
        catch { $certificateOk = $false }
    }
    Add-ReadinessCheck -Id 'release_signing_certificate_available' -ScopeName 'BuildHost' -Passed $certificateOk `
        -ReasonCode $(if ($certificateOk) { 'exact_release_signing_certificate_available' } else { 'release_signing_certificate_missing_ambiguous_or_invalid' }) `
        -Evidence ([ordered]@{ exactMatches = $certificateMatches; privateKeyAndEkuChecked = $certificateOk })

    Add-ArtifactAvailabilityCheck -Id 'release_signing_key_attestation' -ScopeName 'BuildHost' -Path $SigningKeyAttestationPath | Out-Null

    $timestampOk = $false
    try {
        $timestamp = [uri]$TimestampUri
        $timestampOk = $timestamp.IsAbsoluteUri -and $timestamp.Scheme -ceq 'https'
    }
    catch { }
    Add-ReadinessCheck -Id 'release_timestamp_https_configured' -ScopeName 'BuildHost' -Passed $timestampOk `
        -ReasonCode $(if ($timestampOk) { 'https_timestamp_uri_configured_unprobed' } else { 'https_timestamp_uri_not_configured' })

    $wixTime = [DateTimeOffset]::MinValue
    $wixOk = [Environment]::GetEnvironmentVariable('MSAIDIZI_WIX7_EULA_ACCEPTED_BY_AUTHORIZED_ORG') -ceq 'wix7' -and
        -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('MSAIDIZI_WIX7_AUTHORIZED_ACTOR')) -and
        -not [string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable('MSAIDIZI_WIX7_OSMF_COMPLIANCE_REFERENCE')) -and
        [DateTimeOffset]::TryParse([Environment]::GetEnvironmentVariable('MSAIDIZI_WIX7_ACCEPTED_AT_UTC'), [ref]$wixTime) -and
        $wixTime.Offset -eq [TimeSpan]::Zero -and $wixTime -le [DateTimeOffset]::UtcNow
    Add-ReadinessCheck -Id 'wix_legal_attestation_present' -ScopeName 'BuildHost' -Passed $wixOk `
        -ReasonCode $(if ($wixOk) { 'wix_authorized_attestation_present' } else { 'wix_authorized_attestation_missing_or_invalid' })

    $gitOk = $false
    $dirtyCount = -1
    $trackedCount = 0
    try {
        $git = (Get-Command git.exe -ErrorAction Stop).Source
        $headOutput = @(& $git -C $repositoryRoot rev-parse HEAD 2>&1 | ForEach-Object { $_.ToString() })
        $head = ($headOutput -join '').Trim()
        $dirty = @(& $git -C $repositoryRoot status --porcelain=v1 --untracked-files=all -- windows-companion 2>&1 | ForEach-Object { $_.ToString() })
        $dirtyExit = $LASTEXITCODE
        $tracked = @(& $git -C $repositoryRoot ls-files -- windows-companion 2>&1 | ForEach-Object { $_.ToString() })
        $trackedExit = $LASTEXITCODE
        $dirtyCount = @($dirty | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
        $trackedCount = @($tracked | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }).Count
        $gitOk = $head -match '^[0-9a-f]{40}$' -and $dirtyExit -eq 0 -and $trackedExit -eq 0 -and $dirtyCount -eq 0 -and $trackedCount -gt 0
    }
    catch { }
    Add-ReadinessCheck -Id 'source_clean_committed' -ScopeName 'BuildHost' -Passed $gitOk `
        -ReasonCode $(if ($gitOk) { 'windows_companion_clean_and_committed' } else { 'windows_companion_dirty_untracked_or_uncommitted' }) `
        -Evidence ([ordered]@{ dirtyEntryCount = $dirtyCount; trackedEntryCount = $trackedCount })
}

if (Test-ScopeSelected 'VmHost') {
    $hypervisorPresent = $false
    $hyperVEnabled = $false
    try {
        $computerSystem = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction Stop
        $hypervisorPresent = [bool]$computerSystem.HypervisorPresent
    }
    catch { }
    try {
        if (Get-Command Get-WindowsOptionalFeature -ErrorAction SilentlyContinue) {
            $feature = Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V-All -ErrorAction Stop
            $hyperVEnabled = [string]$feature.State -ceq 'Enabled'
        }
    }
    catch { }
    $allowedOrchestratorSigners = if ($null -ne $policy -and $policy.trust.allowedVmOrchestratorSignerThumbprints) {
        @($policy.trust.allowedVmOrchestratorSignerThumbprints | ForEach-Object { [string]$_ })
    }
    else { @() }
    $orchestratorProbe = Test-ExactAuthenticodeFile -Path $VmOrchestratorPath `
        -ExpectedThumbprint $VmOrchestratorSignerThumbprint -AllowedThumbprints $allowedOrchestratorSigners
    $orchestratorOk = $orchestratorProbe.Passed
    Add-ReadinessCheck -Id 'vm_orchestrator_trusted' -ScopeName 'VmHost' -Passed $orchestratorOk `
        -ReasonCode $orchestratorProbe.ReasonCode -Evidence $orchestratorProbe.Evidence

    # HypervisorPresent alone can mean that this process is merely a guest. A
    # lifecycle host therefore passes only with local Hyper-V enabled or an
    # Authenticode-valid orchestrator whose signer is pinned by release policy.
    $hypervisorOk = $hyperVEnabled -or $orchestratorOk
    Add-ReadinessCheck -Id 'vm_hypervisor_available' -ScopeName 'VmHost' -Passed $hypervisorOk `
        -ReasonCode $(if ($hypervisorOk) { 'vm_lifecycle_control_available' } else { 'vm_lifecycle_control_not_available_or_unproven' }) `
        -Evidence ([ordered]@{ runningUnderHypervisor = $hypervisorPresent; hyperVFeatureEnabled = $hyperVEnabled; protectedOrchestratorAvailable = $orchestratorOk })
    Add-ArtifactAvailabilityCheck -Id 'vm_clean_template_evidence' -ScopeName 'VmHost' -Path $VmTemplateEvidencePath | Out-Null
}

if (Test-ScopeSelected 'Operational') {
    Add-ArtifactAvailabilityCheck -Id 'provider_contract_verifier_available' -ScopeName 'Operational' -Path $ProviderContractVerifierPath | Out-Null
    Add-ArtifactAvailabilityCheck -Id 'provider_contract_attestation_available' -ScopeName 'Operational' -Path $ProviderContractAttestationPath | Out-Null
    Add-ArtifactAvailabilityCheck -Id 'provider_contract_public_key_available' -ScopeName 'Operational' -Path $ProviderContractPublicKeyPath | Out-Null
    Add-ArtifactAvailabilityCheck -Id 'provider_contract_document_available' -ScopeName 'Operational' -Path $ProviderContractDocumentPath | Out-Null

    $serviceProgram = ''
    $externalActionAdapters = ''
    $egressFlowTransport = ''
    $privilegedIsolationClient = ''
    $egressSupervisorProgram = ''
    $egressSupervisorIdentity = ''
    $privilegedSupervisorProgram = ''
    $privilegedSupervisorIdentity = ''
    $installerPackage = ''
    try { $serviceProgram = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.Companion.Service\Program.cs') -Raw -Encoding utf8 -ErrorAction Stop } catch { }
    try { $externalActionAdapters = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.Companion.Service\Capabilities\ExternalActionCapabilityAdapters.cs') -Raw -Encoding utf8 -ErrorAction Stop } catch { }
    try { $egressFlowTransport = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.Companion.Service\Capabilities\NamedPipeEgressSupervisorExternalActionTransport.cs') -Raw -Encoding utf8 -ErrorAction Stop } catch { }
    try { $privilegedIsolationClient = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.Companion.Service\Capabilities\NamedPipePrivilegedCommandTrustedRootIsolationClient.cs') -Raw -Encoding utf8 -ErrorAction Stop } catch { }
    try { $egressSupervisorProgram = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.EgressSupervisor\Program.cs') -Raw -Encoding utf8 -ErrorAction Stop } catch { }
    try { $egressSupervisorIdentity = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.EgressSupervisor\EgressSupervisorTrustIdentity.cs') -Raw -Encoding utf8 -ErrorAction Stop } catch { }
    try { $privilegedSupervisorProgram = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.PrivilegedCommandSupervisor\Program.cs') -Raw -Encoding utf8 -ErrorAction Stop } catch { }
    try { $privilegedSupervisorIdentity = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.PrivilegedCommandSupervisor\Security\SupervisorServiceIdentity.cs') -Raw -Encoding utf8 -ErrorAction Stop } catch { }
    try { $installerPackage = Get-Content -LiteralPath (Join-Path $installerRoot 'wix\Package.wxs') -Raw -Encoding utf8 -ErrorAction Stop } catch { }
    $egressClientFactoryPresent = -not [string]::IsNullOrEmpty($serviceProgram) -and
        $serviceProgram.Contains('AddSingleton<IEgressBoundaryClient>(services =>') -and
        $serviceProgram.Contains('EgressBoundaryClientFactory.Create(')
    $supervisorOwnedFlowHandlePresent = -not [string]::IsNullOrEmpty($externalActionAdapters) -and
        $externalActionAdapters.Contains('IEgressLifecycleCapabilityAdapter') -and
        -not [string]::IsNullOrEmpty($egressFlowTransport) -and
        $egressFlowTransport.Contains('NamedPipeEgressSupervisorExternalActionTransport') -and
        $serviceProgram.Contains('ExternalActionTransportFactory.Create(') -and
        $egressSupervisorProgram.Contains('EgressSupervisorTrustIdentity.ServiceName') -and
        $egressSupervisorIdentity.Contains('Itemba Msaidizi Egress Supervisor') -and
        $installerPackage.Contains('Name="Itemba Msaidizi Egress Supervisor"')
    $egressComponentsPresent = $egressClientFactoryPresent -and $supervisorOwnedFlowHandlePresent
    Add-ReadinessCheck -Id 'egress_boundary_client_implemented' -ScopeName 'Operational' -Passed $false `
        -ReasonCode $(if ($egressComponentsPresent) { 'egress_source_components_present_not_deployment_proof' } elseif ($egressClientFactoryPresent) { 'egress_supervisor_owned_flow_path_not_implemented' } else { 'egress_boundary_client_factory_not_present' }) `
        -Evidence ([ordered]@{ sourceInventoryOnly = $true; sourceComponentsPresent = $egressComponentsPresent; productionProof = $false })

    $rejectingIsolationFallbackPresent = -not [string]::IsNullOrEmpty($serviceProgram) -and
        $serviceProgram.Contains('RejectingPrivilegedCommandTrustedRootIsolationGate fallback')
    $trustedRootComponentsPresent = -not [string]::IsNullOrEmpty($serviceProgram) -and
        $serviceProgram.Contains('PrivilegedCommandIsolationClientFactory.Register(builder.Services)') -and
        $serviceProgram.Contains('new NamedPipePrivilegedCommandTrustedRootIsolationClient(') -and
        -not [string]::IsNullOrEmpty($privilegedIsolationClient) -and
        $privilegedIsolationClient.Contains('IPrivilegedCommandTrustedRootIsolationGate') -and
        $rejectingIsolationFallbackPresent -and
        $privilegedSupervisorProgram.Contains('SupervisorServiceIdentity.ServiceName') -and
        $privilegedSupervisorIdentity.Contains('Itemba Msaidizi Privileged Command Supervisor') -and
        $installerPackage.Contains('Name="Itemba Msaidizi Privileged Command Supervisor"')
    Add-ReadinessCheck -Id 'trusted_root_isolation_gate_implemented' -ScopeName 'Operational' -Passed $false `
        -ReasonCode $(if ($trustedRootComponentsPresent) { 'isolation_client_and_fail_closed_fallback_present_not_deployment_proof' } else { 'configured_isolation_client_factory_or_supervisor_missing' }) `
        -Evidence ([ordered]@{ sourceInventoryOnly = $true; sourceComponentsPresent = $trustedRootComponentsPresent; productionProof = $false; rejectingFallbackRetained = $rejectingIsolationFallbackPresent })

    $allowedDeploymentSigners = if ($null -ne $policy -and $policy.trust.allowedOperationalEvidenceSignerThumbprints) {
        @($policy.trust.allowedOperationalEvidenceSignerThumbprints | ForEach-Object { [string]$_ })
    }
    else { @() }
    $maximumDeploymentEvidenceAgeHours = if ($null -ne $policy) {
        [double]$policy.maximumOperationalEvidenceAgeHours
    }
    else { 0 }
    $releaseApprovalSigner = if ($null -ne $policy) {
        [string]$policy.trust.releaseSignerThumbprint
    }
    else { '' }
    $installerVmApproval = Test-DetachedCmsDeploymentEvidence `
        -ContentPath $InstallerVmApprovalPath `
        -SignaturePath $InstallerVmApprovalSignaturePath `
        -ExpectedThumbprint $releaseApprovalSigner `
        -AllowedThumbprints @($releaseApprovalSigner) -Predicate {
            param($claim)
            $approvalProperties = @(
                'schemaVersion', 'status', 'evidenceScope',
                'productionDeploymentEligible', 'approvedAtUtc',
                'releaseManifestSha256', 'version', 'sourceRevision',
                'msiSha256', 'releaseSignerThumbprint', 'vmEvidence',
                'vmDisposition', 'gates'
            )
            $vmEvidenceProperties = @(
                'sha256', 'signerThumbprint', 'runId', 'completedAtUtc'
            )
            return (Test-ExactClaimProperties -Claim $claim -Expected $approvalProperties) -and
                $claim.schemaVersion -is [long] -and $claim.schemaVersion -eq 1 -and
                $claim.status -is [string] -and
                $claim.status -ceq 'INSTALLER_VM_ACCEPTED_AWAITING_OPERATIONAL_COMPANION_ACCEPTANCE' -and
                $claim.evidenceScope -is [string] -and
                $claim.evidenceScope -ceq 'MSI_INSTALL_FAIL_CLOSED_BOOTSTRAP_AND_UNINSTALL_ONLY' -and
                $claim.productionDeploymentEligible -is [bool] -and
                $claim.productionDeploymentEligible -ceq $false -and
                $claim.releaseSignerThumbprint -is [string] -and
                $claim.releaseSignerThumbprint -ceq $releaseApprovalSigner -and
                (Test-ExactClaimProperties -Claim $claim.vmEvidence -Expected $vmEvidenceProperties) -and
                $claim.vmEvidence.runId -is [string] -and
                (Test-CanonicalNonEmptyGuid -Value ([string]$claim.vmEvidence.runId)) -and
                $claim.gates.operationalCompanionAcceptance -is [string] -and
                $claim.gates.operationalCompanionAcceptance -ceq 'NOT_EXECUTED' -and
                $claim.gates.productionRingAcceptance -is [string] -and
                $claim.gates.productionRingAcceptance -ceq 'NOT_EXECUTED'
        }
    $installerVmAcceptedRunId = if ($installerVmApproval.Passed) {
        [string]$installerVmApproval.Claim.vmEvidence.runId
    }
    else { '' }
    $egressDeployment = Test-DetachedCmsDeploymentEvidence `
        -ContentPath $EgressBoundaryDeploymentEvidencePath `
        -SignaturePath $EgressBoundaryDeploymentEvidenceSignaturePath `
        -ExpectedThumbprint $EgressBoundaryDeploymentEvidenceSignerThumbprint `
        -AllowedThumbprints $allowedDeploymentSigners -Predicate {
            param($claim)
            $properties = @(
                'schemaVersion', 'status', 'evidenceType', 'observedAtUtc', 'deviceId',
                'vmRunId', 'serviceName', 'serviceImageSha256',
                'companionServiceImageSha256', 'driverMeasurementSha256',
                'destinationPolicySha256',
                'attestationKeyId', 'attestationCertificateThumbprint',
                'attestationSpkiSha256', 'receiptKeyId',
                'receiptCertificateThumbprint', 'receiptSpkiSha256',
                'hardwareBackedSigningKeysVerified', 'privateKeysNonExportable',
                'serviceOnlyCngKeyDaclsExact',
                'kernelOrWfpEnforcementActive', 'processTreeAttributionActive',
                'supervisorOwnedDataPathConsumed', 'signedReceiptVerified',
                'trustedRootKillSwitchEnforced', 'exactRequestPolicyEnforced',
                'credentialRecordSha256Bound', 'credentialVaultSupervisorReadOnly',
                'supervisorOwnedTlsAndSocket',
                'restrictedServicePeerVerifiedBeforeTokenWrite',
                'processCreationIdentityBoundAcrossFlow',
                'executeOnlyAuthorizationVerified',
                'exactBrokerResidualVerified',
                'mappedSupervisorSelfImageVerified',
                'executeOnlyAuthorizationNegativeControlResultSha256',
                'brokerResidualNegativeControlsResultSha256',
                'mappedSupervisorSelfImageNegativeControlResultSha256'
            )
            $egressKeyIds = @($claim.attestationKeyId, $claim.receiptKeyId)
            $egressThumbprints = @(
                $claim.attestationCertificateThumbprint,
                $claim.receiptCertificateThumbprint)
            $egressSpkiDigests = @(
                $claim.attestationSpkiSha256,
                $claim.receiptSpkiSha256)
            $egressSigningBindingsValid =
                @($egressKeyIds | Where-Object {
                    $_ -is [string] -and $_ -cmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
                }).Count -eq 2 -and
                @($egressThumbprints | Where-Object {
                    $_ -is [string] -and $_ -cmatch '^[0-9A-F]{40}$'
                }).Count -eq 2 -and
                @($egressSpkiDigests | Where-Object {
                    $_ -is [string] -and $_ -cmatch '^[0-9a-f]{64}$'
                }).Count -eq 2 -and
                @($egressKeyIds | Select-Object -Unique).Count -eq 2 -and
                @($egressThumbprints | Select-Object -Unique).Count -eq 2 -and
                @($egressSpkiDigests | Select-Object -Unique).Count -eq 2
            return (Test-ExactClaimProperties -Claim $claim -Expected $properties) -and
                $claim.schemaVersion -is [long] -and $claim.schemaVersion -eq 1 -and
                $claim.status -is [string] -and $claim.status -ceq 'PASS' -and
                $claim.evidenceType -is [string] -and
                $claim.evidenceType -ceq 'MSAIDIZI_EGRESS_ENFORCEMENT_DEPLOYMENT' -and
                $claim.serviceName -is [string] -and
                $claim.serviceName -ceq 'Itemba Msaidizi Egress Supervisor' -and
                $claim.deviceId -is [string] -and
                -not [string]::IsNullOrWhiteSpace($claim.deviceId) -and
                $claim.deviceId -cne 'UNENROLLED' -and
                $claim.vmRunId -is [string] -and
                (Test-CanonicalNonEmptyGuid -Value ([string]$claim.vmRunId)) -and
                $claim.serviceImageSha256 -is [string] -and
                $claim.serviceImageSha256 -cmatch '^[0-9a-f]{64}$' -and
                $claim.companionServiceImageSha256 -is [string] -and
                $claim.companionServiceImageSha256 -cmatch '^[0-9a-f]{64}$' -and
                $claim.driverMeasurementSha256 -is [string] -and
                $claim.driverMeasurementSha256 -cmatch '^[0-9a-f]{64}$' -and
                $claim.destinationPolicySha256 -is [string] -and
                $claim.destinationPolicySha256 -cmatch '^[0-9a-f]{64}$' -and
                $egressSigningBindingsValid -and
                $claim.hardwareBackedSigningKeysVerified -is [bool] -and
                $claim.hardwareBackedSigningKeysVerified -ceq $true -and
                $claim.privateKeysNonExportable -is [bool] -and
                $claim.privateKeysNonExportable -ceq $true -and
                $claim.serviceOnlyCngKeyDaclsExact -is [bool] -and
                $claim.serviceOnlyCngKeyDaclsExact -ceq $true -and
                $claim.kernelOrWfpEnforcementActive -is [bool] -and
                $claim.kernelOrWfpEnforcementActive -ceq $true -and
                $claim.processTreeAttributionActive -is [bool] -and
                $claim.processTreeAttributionActive -ceq $true -and
                $claim.supervisorOwnedDataPathConsumed -is [bool] -and
                $claim.supervisorOwnedDataPathConsumed -ceq $true -and
                $claim.signedReceiptVerified -is [bool] -and
                $claim.signedReceiptVerified -ceq $true -and
                $claim.trustedRootKillSwitchEnforced -is [bool] -and
                $claim.trustedRootKillSwitchEnforced -ceq $true -and
                $claim.exactRequestPolicyEnforced -is [bool] -and
                $claim.exactRequestPolicyEnforced -ceq $true -and
                $claim.credentialRecordSha256Bound -is [bool] -and
                $claim.credentialRecordSha256Bound -ceq $true -and
                $claim.credentialVaultSupervisorReadOnly -is [bool] -and
                $claim.credentialVaultSupervisorReadOnly -ceq $true -and
                $claim.supervisorOwnedTlsAndSocket -is [bool] -and
                $claim.supervisorOwnedTlsAndSocket -ceq $true -and
                $claim.restrictedServicePeerVerifiedBeforeTokenWrite -is [bool] -and
                $claim.restrictedServicePeerVerifiedBeforeTokenWrite -ceq $true -and
                $claim.processCreationIdentityBoundAcrossFlow -is [bool] -and
                $claim.processCreationIdentityBoundAcrossFlow -ceq $true -and
                $claim.executeOnlyAuthorizationVerified -is [bool] -and
                $claim.executeOnlyAuthorizationVerified -ceq $true -and
                $claim.exactBrokerResidualVerified -is [bool] -and
                $claim.exactBrokerResidualVerified -ceq $true -and
                $claim.mappedSupervisorSelfImageVerified -is [bool] -and
                $claim.mappedSupervisorSelfImageVerified -ceq $true -and
                $claim.executeOnlyAuthorizationNegativeControlResultSha256 -is [string] -and
                $claim.executeOnlyAuthorizationNegativeControlResultSha256 -cmatch '^[0-9a-f]{64}$' -and
                $claim.brokerResidualNegativeControlsResultSha256 -is [string] -and
                $claim.brokerResidualNegativeControlsResultSha256 -cmatch '^[0-9a-f]{64}$' -and
                $claim.mappedSupervisorSelfImageNegativeControlResultSha256 -is [string] -and
                $claim.mappedSupervisorSelfImageNegativeControlResultSha256 -cmatch '^[0-9a-f]{64}$' -and
                $claim.observedAtUtc -is [string] -and
                (Test-FreshEvidenceTime -ObservedAtUtc ([string]$claim.observedAtUtc) `
                    -MaximumAgeHours $maximumDeploymentEvidenceAgeHours)
        }
    $egressVmRunBound = $egressDeployment.Passed -and
        $installerVmApproval.Passed -and
        [string]$egressDeployment.Claim.vmRunId -ceq $installerVmAcceptedRunId
    $egressDeployment.Evidence['signedInstallerVmApprovalVerified'] = [bool]$installerVmApproval.Passed
    $egressDeployment.Evidence['vmRunBoundToSignedInstallerAcceptance'] = $egressVmRunBound
    $egressDeploymentReady = $egressComponentsPresent -and
        $egressDeployment.Passed -and
        $installerVmApproval.Passed -and
        $egressVmRunBound
    Add-ReadinessCheck -Id 'egress_boundary_deployment_evidence' -ScopeName 'Operational' -Passed $egressDeploymentReady `
        -ReasonCode $(if (-not $egressComponentsPresent) {
            'egress_source_components_missing'
        } elseif (-not $egressDeployment.Passed) {
            $egressDeployment.ReasonCode
        } elseif (-not $installerVmApproval.Passed) {
            'signed_installer_vm_approval_missing_invalid_or_untrusted'
        } elseif (-not $egressVmRunBound) {
            'deployment_evidence_vm_run_not_bound_to_signed_installer_acceptance'
        } else {
            $egressDeployment.ReasonCode
        }) `
        -Evidence $egressDeployment.Evidence

    $isolationDeployment = Test-DetachedCmsDeploymentEvidence `
        -ContentPath $TrustedRootIsolationEvidencePath `
        -SignaturePath $TrustedRootIsolationEvidenceSignaturePath `
        -ExpectedThumbprint $TrustedRootIsolationEvidenceSignerThumbprint `
        -AllowedThumbprints $allowedDeploymentSigners -Predicate {
            param($claim)
            $properties = @(
                'schemaVersion', 'status', 'evidenceType', 'observedAtUtc', 'deviceId',
                'vmRunId', 'serviceName', 'protocolVersion', 'supervisorServiceSid',
                'supervisorServiceImageSha256',
                'companionServiceImageSha256', 'driverImageSha256',
                'driverMeasurementSha256', 'isolationPolicySha256',
                'isolationJournalSha256',
                'authorizationPersistenceVerificationResultSha256',
                'driverServiceName', 'driverPolicyEpoch',
                'actionTokenExpectedIssuer', 'actionTokenExpectedAudience',
                'actionTokenExpectedSubject',
                'maximumInvocationTimeoutSeconds', 'maximumInvocationOutputBytes',
                'maximumInvocationProcesses', 'maximumInvocationProcessMemoryBytes',
                'reservationLeaseKeyId', 'reservationLeaseCertificateThumbprint',
                'reservationLeaseSpkiSha256', 'preBindReservationReleaseKeyId',
                'preBindReservationReleaseCertificateThumbprint',
                'preBindReservationReleaseSpkiSha256',
                'suspendedProcessBindAcknowledgementKeyId',
                'suspendedProcessBindAcknowledgementCertificateThumbprint',
                'suspendedProcessBindAcknowledgementSpkiSha256',
                'terminalEnforcementReceiptKeyId',
                'terminalEnforcementReceiptCertificateThumbprint',
                'terminalEnforcementReceiptSpkiSha256',
                'actionTokenVerificationKeyId',
                'actionTokenVerificationCertificateThumbprint',
                'actionTokenVerificationSpkiSha256',
                'driverAttestationVerificationKeyId',
                'driverAttestationVerificationCertificateThumbprint',
                'driverAttestationVerificationSpkiSha256',
                'companionPurposePinsMatched', 'hardwareBackedPurposeKeysVerified',
                'privateKeysNonExportable', 'serviceOnlyCngKeyDaclsExact',
                'actionTokenIndependentlyVerified', 'actionTokenClaimsBoundToRequest',
                'authorizationMaterialDigestOnlyPersistenceVerified',
                'verificationCertificatesPublicOnly', 'verificationKeysPurposeDistinct',
                'signedDriverAttestationVerified', 'driverAttestationNonceBound',
                'driverAttestationFresh', 'driverAttestationBootBound',
                'driverAttestationSigningKeyHardwareBacked',
                'secureBootVerified', 'hvciVerified',
                'wdacVerified', 'trustedRootKillSwitchEnforced',
                'restrictedServicePeerVerifiedBeforeTokenWrite',
                'exactInvocationBoundToSignedArguments',
                'suspendedProcessImageIdentityBound',
                'exactSuspendedInvocationMeasurementBound',
                'mappedProcessImageIdentityBound',
                'liveDriverServiceAndLoadedImageVerified',
                'driverDeviceHandleBoundToSignedAttestation',
                'nativeEnforcementActive', 'processTreeBound', 'filesystemDenyActive',
                'registryDenyActive', 'scmDenyActive', 'supervisorProcessDenyActive',
                'signedReceiptVerified'
            )
            $isolationKeyIds = @(
                $claim.reservationLeaseKeyId,
                $claim.preBindReservationReleaseKeyId,
                $claim.suspendedProcessBindAcknowledgementKeyId,
                $claim.terminalEnforcementReceiptKeyId,
                $claim.actionTokenVerificationKeyId,
                $claim.driverAttestationVerificationKeyId)
            $isolationThumbprints = @(
                $claim.reservationLeaseCertificateThumbprint,
                $claim.preBindReservationReleaseCertificateThumbprint,
                $claim.suspendedProcessBindAcknowledgementCertificateThumbprint,
                $claim.terminalEnforcementReceiptCertificateThumbprint,
                $claim.actionTokenVerificationCertificateThumbprint,
                $claim.driverAttestationVerificationCertificateThumbprint)
            $isolationSpkiDigests = @(
                $claim.reservationLeaseSpkiSha256,
                $claim.preBindReservationReleaseSpkiSha256,
                $claim.suspendedProcessBindAcknowledgementSpkiSha256,
                $claim.terminalEnforcementReceiptSpkiSha256,
                $claim.actionTokenVerificationSpkiSha256,
                $claim.driverAttestationVerificationSpkiSha256)
            $isolationKeyBindingsValid =
                @($isolationKeyIds | Where-Object {
                    $_ -is [string] -and $_ -cmatch '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'
                }).Count -eq 6 -and
                @($isolationThumbprints | Where-Object {
                    $_ -is [string] -and $_ -cmatch '^[0-9A-F]{40}$'
                }).Count -eq 6 -and
                @($isolationSpkiDigests | Where-Object {
                    $_ -is [string] -and $_ -cmatch '^[0-9a-f]{64}$'
                }).Count -eq 6 -and
                @($isolationKeyIds | Select-Object -Unique).Count -eq 6 -and
                @($isolationThumbprints | Select-Object -Unique).Count -eq 6 -and
                @($isolationSpkiDigests | Select-Object -Unique).Count -eq 6
            return (Test-ExactClaimProperties -Claim $claim -Expected $properties) -and
                $claim.schemaVersion -is [long] -and $claim.schemaVersion -eq 1 -and
                $claim.status -is [string] -and $claim.status -ceq 'PASS' -and
                $claim.evidenceType -is [string] -and
                $claim.evidenceType -ceq 'MSAIDIZI_PRIVILEGED_COMMAND_ISOLATION_DEPLOYMENT' -and
                $claim.serviceName -is [string] -and
                $claim.serviceName -ceq 'Itemba Msaidizi Privileged Command Supervisor' -and
                $claim.deviceId -is [string] -and
                -not [string]::IsNullOrWhiteSpace($claim.deviceId) -and
                $claim.deviceId -cne 'UNENROLLED' -and
                $claim.vmRunId -is [string] -and
                (Test-CanonicalNonEmptyGuid -Value ([string]$claim.vmRunId)) -and
                $claim.protocolVersion -is [long] -and $claim.protocolVersion -eq 2 -and
                $claim.supervisorServiceSid -is [string] -and
                $claim.supervisorServiceSid -ceq 'S-1-5-80-1792805186-3282615177-1795010573-3676175622-4117989893' -and
                $claim.supervisorServiceImageSha256 -is [string] -and
                $claim.supervisorServiceImageSha256 -cmatch '^[0-9a-f]{64}$' -and
                $claim.companionServiceImageSha256 -is [string] -and
                $claim.companionServiceImageSha256 -cmatch '^[0-9a-f]{64}$' -and
                $claim.driverImageSha256 -is [string] -and
                $claim.driverImageSha256 -cmatch '^[0-9a-f]{64}$' -and
                $claim.driverMeasurementSha256 -is [string] -and
                $claim.driverMeasurementSha256 -cmatch '^[0-9a-f]{64}$' -and
                $claim.isolationPolicySha256 -is [string] -and
                $claim.isolationPolicySha256 -cmatch '^[0-9a-f]{64}$' -and
                $claim.isolationJournalSha256 -is [string] -and
                $claim.isolationJournalSha256 -cmatch '^[0-9a-f]{64}$' -and
                $claim.authorizationPersistenceVerificationResultSha256 -is [string] -and
                $claim.authorizationPersistenceVerificationResultSha256 -cmatch '^[0-9a-f]{64}$' -and
                $claim.driverServiceName -is [string] -and
                $claim.driverServiceName -ceq 'Itemba Msaidizi Privileged Command Isolation Driver' -and
                $claim.driverPolicyEpoch -is [string] -and
                $claim.driverPolicyEpoch -ceq 'isolation-policy-v2' -and
                $claim.actionTokenExpectedIssuer -is [string] -and
                $claim.actionTokenExpectedIssuer -ceq 'itemba-msaidizi-broker' -and
                $claim.actionTokenExpectedAudience -is [string] -and
                $claim.actionTokenExpectedAudience -ceq 'itemba-windows-companion' -and
                $claim.actionTokenExpectedSubject -is [string] -and
                $claim.actionTokenExpectedSubject -ceq 'msaidizi-global' -and
                $claim.maximumInvocationTimeoutSeconds -is [long] -and
                $claim.maximumInvocationTimeoutSeconds -eq 300 -and
                $claim.maximumInvocationOutputBytes -is [long] -and
                $claim.maximumInvocationOutputBytes -eq 1048576 -and
                $claim.maximumInvocationProcesses -is [long] -and
                $claim.maximumInvocationProcesses -eq 16 -and
                $claim.maximumInvocationProcessMemoryBytes -is [long] -and
                $claim.maximumInvocationProcessMemoryBytes -eq 536870912 -and
                $isolationKeyBindingsValid -and
                $claim.reservationLeaseKeyId -ceq 'reservation-lease-v1' -and
                $claim.preBindReservationReleaseKeyId -ceq 'pre-bind-reservation-release-v1' -and
                $claim.suspendedProcessBindAcknowledgementKeyId -ceq 'suspended-process-bind-acknowledgement-v1' -and
                $claim.terminalEnforcementReceiptKeyId -ceq 'terminal-enforcement-receipt-v1' -and
                $claim.actionTokenVerificationKeyId -ceq 'msaidizi-action-token-v1' -and
                $claim.driverAttestationVerificationKeyId -ceq 'isolation-driver-attestation-v2' -and
                $claim.companionPurposePinsMatched -is [bool] -and
                $claim.companionPurposePinsMatched -ceq $true -and
                $claim.hardwareBackedPurposeKeysVerified -is [bool] -and
                $claim.hardwareBackedPurposeKeysVerified -ceq $true -and
                $claim.privateKeysNonExportable -is [bool] -and
                $claim.privateKeysNonExportable -ceq $true -and
                $claim.serviceOnlyCngKeyDaclsExact -is [bool] -and
                $claim.serviceOnlyCngKeyDaclsExact -ceq $true -and
                $claim.actionTokenIndependentlyVerified -is [bool] -and
                $claim.actionTokenIndependentlyVerified -ceq $true -and
                $claim.actionTokenClaimsBoundToRequest -is [bool] -and
                $claim.actionTokenClaimsBoundToRequest -ceq $true -and
                $claim.authorizationMaterialDigestOnlyPersistenceVerified -is [bool] -and
                $claim.authorizationMaterialDigestOnlyPersistenceVerified -ceq $true -and
                $claim.verificationCertificatesPublicOnly -is [bool] -and
                $claim.verificationCertificatesPublicOnly -ceq $true -and
                $claim.verificationKeysPurposeDistinct -is [bool] -and
                $claim.verificationKeysPurposeDistinct -ceq $true -and
                $claim.signedDriverAttestationVerified -is [bool] -and
                $claim.signedDriverAttestationVerified -ceq $true -and
                $claim.driverAttestationNonceBound -is [bool] -and
                $claim.driverAttestationNonceBound -ceq $true -and
                $claim.driverAttestationFresh -is [bool] -and
                $claim.driverAttestationFresh -ceq $true -and
                $claim.driverAttestationBootBound -is [bool] -and
                $claim.driverAttestationBootBound -ceq $true -and
                $claim.driverAttestationSigningKeyHardwareBacked -is [bool] -and
                $claim.driverAttestationSigningKeyHardwareBacked -ceq $true -and
                $claim.secureBootVerified -is [bool] -and
                $claim.secureBootVerified -ceq $true -and
                $claim.hvciVerified -is [bool] -and
                $claim.hvciVerified -ceq $true -and
                $claim.wdacVerified -is [bool] -and
                $claim.wdacVerified -ceq $true -and
                $claim.trustedRootKillSwitchEnforced -is [bool] -and
                $claim.trustedRootKillSwitchEnforced -ceq $true -and
                $claim.restrictedServicePeerVerifiedBeforeTokenWrite -is [bool] -and
                $claim.restrictedServicePeerVerifiedBeforeTokenWrite -ceq $true -and
                $claim.exactInvocationBoundToSignedArguments -is [bool] -and
                $claim.exactInvocationBoundToSignedArguments -ceq $true -and
                $claim.suspendedProcessImageIdentityBound -is [bool] -and
                $claim.suspendedProcessImageIdentityBound -ceq $true -and
                $claim.exactSuspendedInvocationMeasurementBound -is [bool] -and
                $claim.exactSuspendedInvocationMeasurementBound -ceq $true -and
                $claim.mappedProcessImageIdentityBound -is [bool] -and
                $claim.mappedProcessImageIdentityBound -ceq $true -and
                $claim.liveDriverServiceAndLoadedImageVerified -is [bool] -and
                $claim.liveDriverServiceAndLoadedImageVerified -ceq $true -and
                $claim.driverDeviceHandleBoundToSignedAttestation -is [bool] -and
                $claim.driverDeviceHandleBoundToSignedAttestation -ceq $true -and
                $claim.nativeEnforcementActive -is [bool] -and
                $claim.nativeEnforcementActive -ceq $true -and
                $claim.processTreeBound -is [bool] -and
                $claim.processTreeBound -ceq $true -and
                $claim.filesystemDenyActive -is [bool] -and
                $claim.filesystemDenyActive -ceq $true -and
                $claim.registryDenyActive -is [bool] -and
                $claim.registryDenyActive -ceq $true -and
                $claim.scmDenyActive -is [bool] -and
                $claim.scmDenyActive -ceq $true -and
                $claim.supervisorProcessDenyActive -is [bool] -and
                $claim.supervisorProcessDenyActive -ceq $true -and
                $claim.signedReceiptVerified -is [bool] -and
                $claim.signedReceiptVerified -ceq $true -and
                $claim.observedAtUtc -is [string] -and
                (Test-FreshEvidenceTime -ObservedAtUtc ([string]$claim.observedAtUtc) `
                    -MaximumAgeHours $maximumDeploymentEvidenceAgeHours)
        }
    $isolationVmRunBound = $isolationDeployment.Passed -and
        $installerVmApproval.Passed -and
        [string]$isolationDeployment.Claim.vmRunId -ceq $installerVmAcceptedRunId
    $isolationDeployment.Evidence['signedInstallerVmApprovalVerified'] = [bool]$installerVmApproval.Passed
    $isolationDeployment.Evidence['vmRunBoundToSignedInstallerAcceptance'] = $isolationVmRunBound
    $isolationDeploymentReady = $trustedRootComponentsPresent -and
        $isolationDeployment.Passed -and
        $installerVmApproval.Passed -and
        $isolationVmRunBound
    Add-ReadinessCheck -Id 'trusted_root_isolation_evidence' -ScopeName 'Operational' -Passed $isolationDeploymentReady `
        -ReasonCode $(if (-not $trustedRootComponentsPresent) {
            'isolation_source_components_missing'
        } elseif (-not $isolationDeployment.Passed) {
            $isolationDeployment.ReasonCode
        } elseif (-not $installerVmApproval.Passed) {
            'signed_installer_vm_approval_missing_invalid_or_untrusted'
        } elseif (-not $isolationVmRunBound) {
            'deployment_evidence_vm_run_not_bound_to_signed_installer_acceptance'
        } else {
            $isolationDeployment.ReasonCode
        }) `
        -Evidence $isolationDeployment.Evidence
    Add-ArtifactAvailabilityCheck -Id 'device_enrollment_evidence' -ScopeName 'Operational' -Path $DeviceEnrollmentEvidencePath | Out-Null

    Add-ReadinessCheck -Id 'installer_vm_approval_claim' -ScopeName 'Operational' -Passed $installerVmApproval.Passed `
        -ReasonCode $(if ($installerVmApproval.Passed) { 'signed_installer_vm_approval_verified' } else { $installerVmApproval.ReasonCode }) `
        -Evidence $installerVmApproval.Evidence
    Add-ArtifactAvailabilityCheck -Id 'installer_vm_approval_signature' -ScopeName 'Operational' -Path $InstallerVmApprovalSignaturePath | Out-Null

    $operational = Get-JsonClaimProbe -Path $OperationalEvidencePath -Predicate {
        param($claim)
        return [int]$claim.schemaVersion -eq 1 -and [string]$claim.status -ceq 'PASS' -and
            [bool]$claim.productionDeploymentEligible -eq $false -and @($claim.checks).Count -eq 15
    }
    Add-ReadinessCheck -Id 'operational_evidence_claim' -ScopeName 'Operational' -Passed $operational.Passed `
        -ReasonCode $operational.ReasonCode -Evidence $operational.Evidence
    Add-ArtifactAvailabilityCheck -Id 'operational_evidence_signature' -ScopeName 'Operational' -Path $OperationalEvidenceSignaturePath | Out-Null
}

if (Test-ScopeSelected 'Rollout') {
    $ring = Get-JsonClaimProbe -Path $RingEvidencePath -Predicate {
        param($claim)
        $names = @($claim.rings | ForEach-Object { [string]$_.name })
        return [int]$claim.schemaVersion -eq 1 -and [string]$claim.status -ceq 'PASS' -and
            [bool]$claim.productionDeploymentEligible -and @($claim.rings).Count -eq 4 -and
            ($names -join '|') -ceq 'RING_0|RING_5|RING_25|RING_100'
    }
    Add-ReadinessCheck -Id 'ring_evidence_claim' -ScopeName 'Rollout' -Passed $ring.Passed `
        -ReasonCode $ring.ReasonCode -Evidence $ring.Evidence
    Add-ArtifactAvailabilityCheck -Id 'ring_evidence_signature' -ScopeName 'Rollout' -Path $RingEvidenceSignaturePath | Out-Null

    $production = Get-JsonClaimProbe -Path $ProductionAcceptancePath -Predicate {
        param($claim)
        return [int]$claim.schemaVersion -eq 1 -and
            [string]$claim.status -ceq 'PRODUCTION_OPERATIONAL_AND_RING_ACCEPTED' -and
            [bool]$claim.productionDeploymentEligible -and
            [string]$claim.gates.installerVmAcceptance -ceq 'PASS' -and
            [string]$claim.gates.operationalCompanionAcceptance -ceq 'PASS' -and
            [string]$claim.gates.productionRingAcceptance -ceq 'PASS' -and
            [bool]$claim.gates.providerContractCryptographicallyVerified
    }
    Add-ReadinessCheck -Id 'production_acceptance_claim' -ScopeName 'Rollout' -Passed $production.Passed `
        -ReasonCode $production.ReasonCode -Evidence $production.Evidence
    Add-ArtifactAvailabilityCheck -Id 'production_acceptance_signature' -ScopeName 'Rollout' -Path $ProductionAcceptanceSignaturePath | Out-Null
}

$blocked = @($checks | Where-Object { $_.status -ceq 'BLOCKED' })
$inputSetComplete = $blocked.Count -eq 0
$report = [ordered]@{
    schemaVersion = 1
    assessmentType = 'MSAIDIZI_PRODUCTION_PREREQUISITE_INVENTORY'
    authority = 'NON_AUTHORITATIVE_READ_ONLY_INVENTORY'
    assessedAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    scopes = @($selectedScopes | Sort-Object)
    state = if ($inputSetComplete) { 'INPUT_SET_COMPLETE_REQUIRES_AUTHORITATIVE_SIGNED_GATES' } else { 'NOT_READY' }
    inputSetComplete = $inputSetComplete
    productionDeploymentEligible = $false
    blockingCheckCount = $blocked.Count
    passedCheckCount = @($checks | Where-Object { $_.status -ceq 'PASS' }).Count
    totalCheckCount = $checks.Count
    nextAuthority = 'Externally trusted signed release, VM, operational, ring, and deployment controllers'
    checks = @($checks)
}

[Console]::Out.WriteLine(($report | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 12 -Compress))
if (-not $inputSetComplete) { exit 2 }
exit 0
