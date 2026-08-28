[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')]
    [string]$Version,

    [string]$SourceRevision,

    [string]$OutputRoot,

    [Parameter(Mandatory)][string]$DotNetPath,
    [Parameter(Mandatory)][string]$SignToolPath,
    [Parameter(Mandatory)][string]$SbomToolPath,
    [Parameter(Mandatory)][ValidatePattern('^[0-9A-Fa-f]{64}$')][string]$SbomToolSha256,
    [Parameter(Mandatory)][string]$DefenderCommandPath,
    [Parameter(Mandatory)][string]$SigningCertificateThumbprint,
    [Parameter(Mandatory)][uri]$TimestampUri,
    [Parameter(Mandatory)][uri]$SbomNamespaceBase
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($PSVersionTable.PSEdition -cne 'Core' -or
    $PSVersionTable.PSVersion.Major -ne 7 -or
    $PSVersionTable.PSVersion.Minor -lt 4) {
    throw 'Signed release construction requires PowerShell Core 7.4 or newer in the 7.x release line.'
}

# SECURITY BOUNDARY: A trusted CI bootstrap, WDAC policy, or equivalent external
# verifier must validate this entry script before PowerShell parses/executes it.
# The checks below protect subsequent module loading; they cannot make this
# already-running entry script its own root of trust.
$embeddedPipelineSignerThumbprint = 'PROVISIONING_REQUIRED'
$embeddedReleasePolicySha256 = '2F58E627B61FF938663A91481E33E485486CE68D120438969F19202FC0BCD8B2'
$embeddedProtectedSourceVerificationSha256 = '48743A65A3F979D4270EECFCBC01631CF2943EBCBF1D437DA7798A93422AA75E'
$installerRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($PSScriptRoot, '..'))
$companionRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($installerRoot, '..'))
$repositoryRoot = [IO.Path]::GetFullPath([IO.Path]::Combine($companionRoot, '..'))
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
    throw 'Protected release-policy.json must pin real pipeline and release signer thumbprints before release.'
}
$requestedReleaseSigner = ($SigningCertificateThumbprint -replace '\s', '').ToUpperInvariant()
if ($requestedReleaseSigner -ne $pinnedReleaseSigner) {
    throw 'Caller-controlled release signer substitution was refused by protected policy.'
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
$signerThumbprint = Normalize-Thumbprint -Thumbprint $pinnedReleaseSigner
Assert-TrustedPipelineScript -Path $PSCommandPath -ExpectedThumbprint $pinnedPipelineSigner
Assert-TrustedPipelineScript -Path $modulePath -ExpectedThumbprint $pinnedPipelineSigner
Assert-HttpsTimestampUri -TimestampUri $TimestampUri
if (-not $SbomNamespaceBase.IsAbsoluteUri -or $SbomNamespaceBase.Scheme -ne 'https') {
    throw 'SbomNamespaceBase must be an absolute HTTPS URI controlled by the release organization.'
}

if ([string]$policy.dotnetSdkVersion -ne '8.0.400' -or
    [string]$policy.runtimeIdentifier -ne 'win-x64' -or
    [string]$policy.wixToolsetVersion -ne '7.0.0' -or
    [string]$policy.sbomToolVersion -ne '4.1.5') {
    throw 'release-policy.json contains an unsupported or unreviewed toolchain version.'
}

$dotnet = Assert-MicrosoftSignedTool -Path $DotNetPath -Description '.NET SDK host'
$actualDotNetHostSha256 = Assert-AuthenticatedToolHash -Path $dotnet `
    -PolicySha256 ([string]$policy.dotnetHostSha256) -Description '.NET SDK host'
$actualDotnetVersion = ((Invoke-CheckedNative -FilePath $dotnet -ArgumentList @('--version') -Description '.NET SDK version') -join '').Trim()
if ($actualDotnetVersion -ne [string]$policy.dotnetSdkVersion) {
    throw "Expected .NET SDK $($policy.dotnetSdkVersion), found $actualDotnetVersion."
}

$signTool = Assert-MicrosoftSignedTool -Path $SignToolPath -Description 'Windows SDK SignTool'
$sbomTool = Resolve-ExistingLeafPath -Path $SbomToolPath -Description 'Microsoft SBOM Tool'
$actualSbomHash = Assert-AuthenticatedToolHash -Path $sbomTool `
    -PolicySha256 ([string]$policy.sbomToolSha256) -ClaimedSha256 $SbomToolSha256 `
    -Description 'SBOM Tool'
$sbomSignature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $sbomTool
if ($sbomSignature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
    -not $sbomSignature.SignerCertificate -or
    $sbomSignature.SignerCertificate.Subject -notmatch '(?i)Microsoft') {
    throw 'Microsoft SBOM Tool must have a valid Microsoft Authenticode signature.'
}
$sbomVersionOutput = (Invoke-CheckedNative -FilePath $sbomTool -ArgumentList @('--version') -Description 'SBOM Tool version') -join "`n"
if ($sbomVersionOutput -notmatch '(?<![0-9])4\.1\.5(?![0-9])') {
    throw "Expected Microsoft SBOM Tool 4.1.5. Output was: $sbomVersionOutput"
}

$signingCertificate = Get-ExactSigningCertificate -Thumbprint $signerThumbprint

if ($env:MSAIDIZI_WIX7_EULA_ACCEPTED_BY_AUTHORIZED_ORG -cne 'wix7') {
    throw 'An authorized organization representative must explicitly set MSAIDIZI_WIX7_EULA_ACCEPTED_BY_AUTHORIZED_ORG=wix7 after satisfying the WiX 7 OSMF terms.'
}
if ([string]::IsNullOrWhiteSpace($env:MSAIDIZI_WIX7_AUTHORIZED_ACTOR) -or
    [string]::IsNullOrWhiteSpace($env:MSAIDIZI_WIX7_OSMF_COMPLIANCE_REFERENCE)) {
    throw 'WiX 7 acceptance requires MSAIDIZI_WIX7_AUTHORIZED_ACTOR and MSAIDIZI_WIX7_OSMF_COMPLIANCE_REFERENCE audit values.'
}
$wixAcceptanceTime = [DateTimeOffset]::MinValue
if (-not [DateTimeOffset]::TryParse($env:MSAIDIZI_WIX7_ACCEPTED_AT_UTC, [ref]$wixAcceptanceTime) -or
    $wixAcceptanceTime.Offset -ne [TimeSpan]::Zero -or
    $wixAcceptanceTime -gt [DateTimeOffset]::UtcNow) {
    throw 'MSAIDIZI_WIX7_ACCEPTED_AT_UTC must be a non-future UTC timestamp recorded by the authorized organization representative.'
}

$git = (Get-Command git.exe -ErrorAction Stop).Source
Push-Location $repositoryRoot
try {
    $headRevision = ((Invoke-CheckedNative -FilePath $git -ArgumentList @('rev-parse', 'HEAD') -Description 'resolve Git revision') -join '').Trim().ToLowerInvariant()
    if ($headRevision -notmatch '^[0-9a-f]{40}$') {
        throw 'Git did not return a full 40-character source revision.'
    }
    if ($SourceRevision) {
        $requestedRevision = $SourceRevision.ToLowerInvariant()
        if ($requestedRevision -notmatch '^[0-9a-f]{40}$' -or $requestedRevision -ne $headRevision) {
            throw 'SourceRevision must exactly equal the checked-out 40-character HEAD revision.'
        }
    }
    else {
        $SourceRevision = $headRevision
    }
    $dirty = @(Invoke-CheckedNative -FilePath $git -ArgumentList @('status', '--porcelain=v1', '--untracked-files=all', '--', 'windows-companion') -Description 'verify clean release source')
    if (($dirty -join '').Length -ne 0) {
        throw "windows-companion must be clean and committed before release:`n$($dirty -join "`n")"
    }
}
finally {
    Pop-Location
}

$sourceVerificationScript = Resolve-ExistingLeafPath `
    -Path (Join-Path $companionRoot 'scripts\Invoke-ProtectedSourceVerification.ps1') `
    -Description 'protected source verification runner'
$sourceVerificationReadLock = [IO.File]::Open(
    $sourceVerificationScript,
    [IO.FileMode]::Open,
    [IO.FileAccess]::Read,
    [IO.FileShare]::Read)
try {
    $sourceVerificationHasher = [Security.Cryptography.SHA256]::Create()
    try {
        $actualSourceVerificationSha256 = [BitConverter]::ToString(
            $sourceVerificationHasher.ComputeHash($sourceVerificationReadLock)).Replace('-', '')
    }
    finally {
        $sourceVerificationHasher.Dispose()
    }
    if ($embeddedProtectedSourceVerificationSha256 -notmatch '^[0-9A-F]{64}$' -or
        $actualSourceVerificationSha256 -cne $embeddedProtectedSourceVerificationSha256) {
        throw 'Protected source verification runner does not match the digest embedded in this signed entry script.'
    }

    & $sourceVerificationScript -DotNetPath $dotnet
    if (-not $?) {
        throw 'Protected source verification failed.'
    }
}
finally {
    $sourceVerificationReadLock.Dispose()
}

# Tests and analyzers are untrusted repository content. Recheck the complete
# Windows source after they run so a gate that writes source cannot influence
# the subsequently signed payload without making the release fail closed.
Push-Location $repositoryRoot
try {
    $postVerificationDirty = @(Invoke-CheckedNative -FilePath $git -ArgumentList @(
        'status', '--porcelain=v1', '--untracked-files=all', '--', 'windows-companion'
    ) -Description 'verify source remained clean during protected verification')
    if (($postVerificationDirty -join '').Length -ne 0) {
        throw "Protected verification changed Windows companion source:`n$($postVerificationDirty -join "`n")"
    }
}
finally {
    Pop-Location
}

$lockedProps = Join-Path $installerRoot 'build\LockedRestore.props'
$requiredLocks = @(
    'Msaidizi.Companion.Contracts.packages.lock.json',
    'Msaidizi.Companion.Service.packages.lock.json',
    'Msaidizi.Companion.Agent.packages.lock.json',
    'Msaidizi.UpdateSupervisor.packages.lock.json',
    'Msaidizi.RecoverySupervisor.packages.lock.json',
    'Msaidizi.AuditSigner.packages.lock.json',
    'Msaidizi.EgressSupervisor.packages.lock.json',
    'Msaidizi.PrivilegedCommandSupervisor.packages.lock.json',
    'provider-contract-verifier.packages.lock.json',
    'wix.packages.lock.json'
)
foreach ($lockName in $requiredLocks) {
    $lockPath = Join-Path (Join-Path $installerRoot 'locks') $lockName
    $lockItem = Get-Item -LiteralPath $lockPath -Force -ErrorAction Stop
    if ($lockItem.Length -eq 0) {
        throw "Package lock file is empty: $lockPath"
    }
    Get-Content -LiteralPath $lockPath -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json | Out-Null
}

Invoke-CheckedNative -FilePath $DefenderCommandPath -ArgumentList @('-SignatureUpdate') -Description 'Microsoft Defender signature update' | Out-Null
$defender = Assert-DefenderReady -DefenderCommandPath $DefenderCommandPath -MaximumSignatureAgeHours ([int]$policy.maximumDefenderSignatureAgeHours)

if (-not $OutputRoot) {
    $OutputRoot = Join-Path $installerRoot 'artifacts'
}
if (-not (Test-Path -LiteralPath $OutputRoot)) {
    $outputParent = Split-Path -Parent ([IO.Path]::GetFullPath($OutputRoot))
    if ([IO.Path]::GetFullPath($outputParent).TrimEnd('\') -ne $installerRoot.TrimEnd('\')) {
        throw 'A missing output root may only be created directly beneath the installer directory.'
    }
    New-Item -ItemType Directory -Path $OutputRoot -ErrorAction Stop | Out-Null
}
$outputRootPath = Resolve-ExistingDirectoryPath -Path $OutputRoot -Description 'release output root'
$candidatePath = Assert-SafeNewDirectoryPath -Path (Join-Path $outputRootPath "$Version-$($SourceRevision.Substring(0, 12))") -RequiredParent $outputRootPath
New-Item -ItemType Directory -Path $candidatePath -ErrorAction Stop | Out-Null
$payloadRoot = New-Item -ItemType Directory -Path (Join-Path $candidatePath 'payload') -ErrorAction Stop
$packageRoot = New-Item -ItemType Directory -Path (Join-Path $candidatePath 'package') -ErrorAction Stop
$evidenceRoot = New-Item -ItemType Directory -Path (Join-Path $candidatePath 'evidence') -ErrorAction Stop
$supportRoot = New-Item -ItemType Directory -Path (Join-Path $candidatePath 'support') -ErrorAction Stop
Assert-VerifiedCandidateLayout -OutputRoot $outputRootPath -CandidateRoot $candidatePath

$projects = @(
    [ordered]@{ Name = 'Service'; Project = 'src\Msaidizi.Companion.Service\Msaidizi.Companion.Service.csproj'; Directory = 'Service' },
    [ordered]@{ Name = 'Agent'; Project = 'src\Msaidizi.Companion.Agent\Msaidizi.Companion.Agent.csproj'; Directory = 'Agent' },
    [ordered]@{ Name = 'UpdateSupervisor'; Project = 'src\Msaidizi.UpdateSupervisor\Msaidizi.UpdateSupervisor.csproj'; Directory = 'UpdateSupervisor' },
    [ordered]@{ Name = 'RecoverySupervisor'; Project = 'src\Msaidizi.RecoverySupervisor\Msaidizi.RecoverySupervisor.csproj'; Directory = 'RecoverySupervisor' },
    [ordered]@{ Name = 'AuditSigner'; Project = 'src\Msaidizi.AuditSigner\Msaidizi.AuditSigner.csproj'; Directory = 'AuditSigner' },
    [ordered]@{ Name = 'EgressSupervisor'; Project = 'src\Msaidizi.EgressSupervisor\Msaidizi.EgressSupervisor.csproj'; Directory = 'EgressSupervisor' },
    [ordered]@{ Name = 'PrivilegedCommandSupervisor'; Project = 'src\Msaidizi.PrivilegedCommandSupervisor\Msaidizi.PrivilegedCommandSupervisor.csproj'; Directory = 'PrivilegedCommandSupervisor' }
)

foreach ($project in $projects) {
    $projectPath = Join-Path $companionRoot $project.Project
    Invoke-CheckedNative -FilePath $dotnet -Description "locked restore $($project.Name)" -ArgumentList @(
        'restore', $projectPath, '--locked-mode', '--force', '--no-cache', '-r', 'win-x64',
        "-p:DirectoryBuildPropsPath=$lockedProps", '-p:RestoreLockedMode=true'
    ) -OutputPath (Join-Path $evidenceRoot.FullName "restore-$($project.Name).log") | Out-Null

    $destination = New-Item -ItemType Directory -Path (Join-Path $payloadRoot.FullName $project.Directory) -ErrorAction Stop
    Assert-VerifiedDirectChildDirectory -Parent $payloadRoot.FullName -Child $destination.FullName -ExpectedLeafName $project.Directory | Out-Null
    Invoke-CheckedNative -FilePath $dotnet -Description "reproducible publish $($project.Name)" -ArgumentList @(
        'publish', $projectPath, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
        '--no-restore', '-o', $destination.FullName,
        "-p:DirectoryBuildPropsPath=$lockedProps", '-p:RestoreLockedMode=true',
        '-p:ContinuousIntegrationBuild=true', '-p:Deterministic=true',
        "-p:Version=$Version", "-p:FileVersion=$Version.0", "-p:PathMap=$companionRoot=/_/windows-companion",
        '-p:DebugType=embedded', '-p:DebugSymbols=false', '-p:PublishReadyToRun=false',
        '-p:PublishTrimmed=false', '-p:UseAppHost=true'
    ) -OutputPath (Join-Path $evidenceRoot.FullName "publish-$($project.Name).log") | Out-Null

    $stagedConfig = Join-Path $destination.FullName 'appsettings.json'
    if (Test-Path -LiteralPath $stagedConfig) {
        Assert-VerifiedCandidateLayout -OutputRoot $outputRootPath -CandidateRoot $candidatePath
        Remove-VerifiedStagedConfiguration -PayloadRoot $payloadRoot.FullName -PublishDirectory $destination.FullName -Path $stagedConfig
    }
}

$hardeningProject = Join-Path $installerRoot 'src\Itemba.Msaidizi.Installer.Hardening\Itemba.Msaidizi.Installer.Hardening.csproj'
Invoke-CheckedNative -FilePath $dotnet -Description 'locked restore installer hardening helper' -ArgumentList @(
    'restore', $hardeningProject, '--locked-mode', '--force', '--no-cache', '-r', 'win-x64', '-p:RestoreLockedMode=true'
) -OutputPath (Join-Path $evidenceRoot.FullName 'restore-InstallerHardening.log') | Out-Null
$helperDestination = New-Item -ItemType Directory -Path (Join-Path $payloadRoot.FullName 'Installer') -ErrorAction Stop
Assert-VerifiedDirectChildDirectory -Parent $payloadRoot.FullName -Child $helperDestination.FullName -ExpectedLeafName 'Installer' | Out-Null
Invoke-CheckedNative -FilePath $dotnet -Description 'reproducible publish installer hardening helper' -ArgumentList @(
    'publish', $hardeningProject, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
    '--no-restore', '-o', $helperDestination.FullName, '-p:RestoreLockedMode=true',
    '-p:ContinuousIntegrationBuild=true', '-p:Deterministic=true',
    "-p:Version=$Version", "-p:FileVersion=$Version.0", "-p:PathMap=$companionRoot=/_/windows-companion",
    '-p:DebugType=embedded', '-p:DebugSymbols=false', '-p:PublishReadyToRun=false'
) -OutputPath (Join-Path $evidenceRoot.FullName 'publish-InstallerHardening.log') | Out-Null

$providerVerifierProject = Join-Path $installerRoot 'src\Itemba.Msaidizi.ProviderContractVerifier\Itemba.Msaidizi.ProviderContractVerifier.csproj'
Invoke-CheckedNative -FilePath $dotnet -Description 'locked restore provider-contract verifier' -ArgumentList @(
    'restore', $providerVerifierProject, '--locked-mode', '--force', '--no-cache', '-r', 'win-x64',
    '-p:RestoreLockedMode=true'
) -OutputPath (Join-Path $evidenceRoot.FullName 'restore-ProviderContractVerifier.log') | Out-Null
$providerVerifierDestination = New-Item -ItemType Directory `
    -Path (Join-Path $supportRoot.FullName 'ProviderContractVerifier') -ErrorAction Stop
Assert-VerifiedDirectChildDirectory -Parent $supportRoot.FullName `
    -Child $providerVerifierDestination.FullName -ExpectedLeafName 'ProviderContractVerifier' | Out-Null
Invoke-CheckedNative -FilePath $dotnet -Description 'reproducible publish provider-contract verifier' -ArgumentList @(
    'publish', $providerVerifierProject, '-c', 'Release', '-r', 'win-x64', '--self-contained', 'true',
    '--no-restore', '-o', $providerVerifierDestination.FullName, '-p:RestoreLockedMode=true',
    '-p:ContinuousIntegrationBuild=true', '-p:Deterministic=true',
    "-p:Version=$Version", "-p:FileVersion=$Version.0", "-p:PathMap=$companionRoot=/_/windows-companion",
    '-p:DebugType=embedded', '-p:DebugSymbols=false', '-p:PublishReadyToRun=false'
) -OutputPath (Join-Path $evidenceRoot.FullName 'publish-ProviderContractVerifier.log') | Out-Null

$vmAcceptanceSource = Join-Path $installerRoot 'vm\Invoke-MsaidiziVmAcceptance.ps1'
$vmAcceptanceDestination = Join-Path $supportRoot.FullName 'Invoke-MsaidiziVmAcceptance.ps1'
Copy-Item -LiteralPath $vmAcceptanceSource -Destination $vmAcceptanceDestination -ErrorAction Stop
Copy-Item -LiteralPath (Join-Path $installerRoot 'vm\README.md') -Destination (Join-Path $supportRoot.FullName 'VM-ACCEPTANCE.md') -ErrorAction Stop
Copy-Item -LiteralPath (Join-Path $installerRoot 'vm\vm-disposition.schema.json') -Destination (Join-Path $supportRoot.FullName 'vm-disposition.schema.json') -ErrorAction Stop
Copy-Item -LiteralPath (Join-Path $installerRoot 'operational\README.md') -Destination (Join-Path $supportRoot.FullName 'OPERATIONAL-ACCEPTANCE.md') -ErrorAction Stop
Copy-Item -LiteralPath (Join-Path $installerRoot 'operational\operational-acceptance.schema.json') -Destination (Join-Path $supportRoot.FullName 'operational-acceptance.schema.json') -ErrorAction Stop
Copy-Item -LiteralPath (Join-Path $installerRoot 'operational\ring-acceptance.schema.json') -Destination (Join-Path $supportRoot.FullName 'ring-acceptance.schema.json') -ErrorAction Stop

Assert-VerifiedCandidateLayout -OutputRoot $outputRootPath -CandidateRoot $candidatePath
Protect-UnsignedStagedArtifacts -Root $payloadRoot.FullName -SignToolPath $signTool -CertificateThumbprint $signerThumbprint -TimestampUri $TimestampUri
Protect-UnsignedStagedArtifacts -Root $supportRoot.FullName -SignToolPath $signTool -CertificateThumbprint $signerThumbprint -TimestampUri $TimestampUri

Invoke-CheckedNative -FilePath $defender.CommandPath -Description 'Microsoft Defender scan of signed payload' -ArgumentList @(
    '-Scan', '-ScanType', '3', '-File', $payloadRoot.FullName, '-DisableRemediation'
) -OutputPath (Join-Path $evidenceRoot.FullName 'defender-payload.log') | Out-Null

function Find-VulnerabilityRecords {
    param([Parameter(Mandatory)]$Node, [string]$Path = '$')

    $records = [Collections.Generic.List[object]]::new()
    if ($null -eq $Node) { return $records }
    if ($Node -is [Collections.IDictionary]) {
        foreach ($key in $Node.Keys) {
            $value = $Node[$key]
            if ([string]$key -eq 'vulnerabilities' -and $null -ne $value -and @($value).Count -gt 0) {
                $records.Add([pscustomobject]@{ Path = "$Path.$key"; Value = $value })
            }
            foreach ($record in @(Find-VulnerabilityRecords -Node $value -Path "$Path.$key")) { $records.Add($record) }
        }
    }
    elseif ($Node -is [Collections.IEnumerable] -and $Node -isnot [string]) {
        $index = 0
        foreach ($item in $Node) {
            foreach ($record in @(Find-VulnerabilityRecords -Node $item -Path "$Path[$index]")) { $records.Add($record) }
            $index++
        }
    }
    else {
        foreach ($property in $Node.PSObject.Properties) {
            $value = $property.Value
            if ($property.Name -eq 'vulnerabilities' -and $null -ne $value -and @($value).Count -gt 0) {
                $records.Add([pscustomobject]@{ Path = "$Path.$($property.Name)"; Value = $value })
            }
            foreach ($record in @(Find-VulnerabilityRecords -Node $value -Path "$Path.$($property.Name)")) { $records.Add($record) }
        }
    }
    return $records
}

$scanProjects = @($projects | ForEach-Object { Join-Path $companionRoot $_.Project }) + @($hardeningProject)
foreach ($projectPath in $scanProjects) {
    $scanName = [IO.Path]::GetFileNameWithoutExtension($projectPath)
    $scanPath = Join-Path $evidenceRoot.FullName "nuget-vulnerabilities-$scanName.json"
    $scanOutput = Invoke-CheckedNative -FilePath $dotnet -Description "NuGet vulnerability scan $scanName" -ArgumentList @(
        'list', $projectPath, 'package', '--vulnerable', '--include-transitive', '--format', 'json', '--no-restore'
    )
    $scanOutput | Set-Content -LiteralPath $scanPath -Encoding utf8
    $scanJson = ($scanOutput -join "`n") | Microsoft.PowerShell.Utility\ConvertFrom-Json
    $vulnerabilities = @(Find-VulnerabilityRecords -Node $scanJson)
    if ($vulnerabilities.Count -ne 0) {
        throw "NuGet reported vulnerable packages for $scanName."
    }
}

$wixProject = Join-Path $installerRoot 'wix\Itemba.Msaidizi.Companion.Installer.wixproj'
$wixValidationEvidence = Join-Path $evidenceRoot.FullName 'wix-msi-validation.txt'
Assert-VerifiedCandidateLayout -OutputRoot $outputRootPath -CandidateRoot $candidatePath
Invoke-CheckedNative -FilePath $dotnet -Description 'locked WiX 7 restore' -ArgumentList @(
    'restore', $wixProject, '--locked-mode', '--force', '--no-cache', '-p:RestoreLockedMode=true', '-p:AcceptEula=wix7'
) -OutputPath (Join-Path $evidenceRoot.FullName 'restore-WiX.log') | Out-Null
Invoke-CheckedNative -FilePath $dotnet -Description 'WiX 7 x64 MSI build' -ArgumentList @(
    'build', $wixProject, '-t:Rebuild', '-c', 'Release', '--no-restore', '-p:Platform=x64',
    "-p:ProductVersion=$Version", "-p:PayloadRoot=$($payloadRoot.FullName)",
    "-p:ConfigRoot=$(Join-Path $installerRoot 'config')", '-p:AcceptEula=wix7',
    '-p:RestoreLockedMode=true', '-p:SuppressValidation=false', '-p:TreatWarningsAsErrors=true',
    '-p:Pedantic=true', '-p:SuppressAllWarnings=false', '-p:SuppressSpecificWarnings=',
    '-p:SuppressIces=', '-p:ValidationAdditionalOptions=', '-p:VerboseOutput=true',
    "-p:ValidationEvidencePath=$wixValidationEvidence", '--output', $packageRoot.FullName
) -OutputPath (Join-Path $evidenceRoot.FullName 'build-WiX.log') | Out-Null
if (-not (Test-Path -LiteralPath $wixValidationEvidence -PathType Leaf)) {
    throw 'WiX emitted an MSI without the post-ICE validation evidence marker.'
}
$wixValidationText = Get-Content -LiteralPath $wixValidationEvidence -Raw -Encoding utf8
if ($wixValidationText -notmatch 'schema-and-stock-ice-validation=PASS' -or
    $wixValidationText -notmatch 'warnings-as-errors=true' -or
    $wixValidationText -notmatch 'suppressed-ices=none') {
    throw 'WiX MSI validation evidence is incomplete or inconsistent.'
}

$msiFiles = @(Get-ChildItem -LiteralPath $packageRoot.FullName -File -Filter '*.msi')
if ($msiFiles.Count -ne 1) {
    throw "Expected exactly one MSI output, found $($msiFiles.Count)."
}
$msiPath = $msiFiles[0].FullName
Invoke-SignToolSign -SignToolPath $signTool -CertificateThumbprint $signerThumbprint -TimestampUri $TimestampUri -Path $msiPath

$sbomNamespace = [uri]($SbomNamespaceBase.AbsoluteUri.TrimEnd('/') + "/$Version/$SourceRevision")
Invoke-CheckedNative -FilePath $sbomTool -Description 'generate SPDX SBOM' -ArgumentList @(
    'generate', '-b', $candidatePath, '-bc', $companionRoot, '-pn', [string]$policy.packageName,
    '-pv', $Version, '-ps', [string]$policy.manufacturer, '-nsb', $sbomNamespace.AbsoluteUri,
    '-m', $evidenceRoot.FullName
) -OutputPath (Join-Path $evidenceRoot.FullName 'sbom-generate.log') | Out-Null
$sbomValidationOutput = Join-Path $evidenceRoot.FullName 'sbom-validation.json'
Invoke-CheckedNative -FilePath $sbomTool -Description 'validate SPDX SBOM' -ArgumentList @(
    'validate', '-b', $candidatePath, '-o', $sbomValidationOutput, '-mi', 'SPDX:2.2', '-m', (Join-Path $evidenceRoot.FullName '_manifest')
) -OutputPath (Join-Path $evidenceRoot.FullName 'sbom-validate.log') | Out-Null
if (-not (Test-Path -LiteralPath $sbomValidationOutput)) {
    throw 'SBOM validation did not produce its required evidence output.'
}

Invoke-CheckedNative -FilePath $defender.CommandPath -Description 'Microsoft Defender final candidate scan' -ArgumentList @(
    '-Scan', '-ScanType', '3', '-File', $candidatePath, '-DisableRemediation'
) -OutputPath (Join-Path $evidenceRoot.FullName 'defender-candidate.log') | Out-Null
Invoke-CheckedNative -FilePath $defender.CommandPath -Description 'Microsoft Defender final MSI scan' -ArgumentList @(
    '-Scan', '-ScanType', '3', '-File', $msiPath, '-DisableRemediation'
) -OutputPath (Join-Path $evidenceRoot.FullName 'defender-msi.log') | Out-Null

$defenderStatus = Get-MpComputerStatus -ErrorAction Stop
$defenderEvidence = [ordered]@{
    antivirusEnabled = [bool]$defenderStatus.AntivirusEnabled
    antimalwareServiceEnabled = [bool]$defenderStatus.AMServiceEnabled
    realTimeProtectionEnabled = [bool]$defenderStatus.RealTimeProtectionEnabled
    signatureVersion = [string]$defenderStatus.AntivirusSignatureVersion
    signatureLastUpdatedUtc = ([DateTimeOffset]$defenderStatus.AntivirusSignatureLastUpdated).ToUniversalTime().ToString('O')
}
$defenderEvidence | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $evidenceRoot.FullName 'defender-status.json') -Encoding utf8

$manifestPath = Join-Path $candidatePath 'release-manifest.json'
$manifestSignaturePath = "$manifestPath.p7s"
Assert-VerifiedCandidateLayout -OutputRoot $outputRootPath -CandidateRoot $candidatePath
$inventory = Get-RelativeFileHashInventory -Root $candidatePath -ExcludeRelativePaths @('release-manifest.json', 'release-manifest.json.p7s')
$manifest = [ordered]@{
    schemaVersion = 1
    status = 'AWAITING_SIGNED_DISPOSABLE_VM_ACCEPTANCE'
    packageName = [string]$policy.packageName
    version = $Version
    sourceRevision = $SourceRevision
    runtimeIdentifier = [string]$policy.runtimeIdentifier
    createdAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    codeSigningThumbprint = $signerThumbprint
    msi = [ordered]@{
        path = Get-RelativePathUnderRoot -Root $candidatePath -Path $msiPath
        sha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $msiPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    toolchain = [ordered]@{
        dotnetSdkVersion = [string]$policy.dotnetSdkVersion
        dotnetHostSha256 = $actualDotNetHostSha256.ToLowerInvariant()
        wixToolsetVersion = [string]$policy.wixToolsetVersion
        sbomToolVersion = [string]$policy.sbomToolVersion
        sbomToolSha256 = $actualSbomHash.ToLowerInvariant()
    }
    wixLegalAttestation = [ordered]@{
        eulaId = 'wix7'
        authorizedActor = $env:MSAIDIZI_WIX7_AUTHORIZED_ACTOR
        acceptedAtUtc = $wixAcceptanceTime.ToUniversalTime().ToString('O')
        osmfComplianceReference = $env:MSAIDIZI_WIX7_OSMF_COMPLIANCE_REFERENCE
    }
    requiredAcceptance = [ordered]@{
        disposableWindowsVm = $true
        vmEvidenceMaximumAgeHours = [int]$policy.maximumVmEvidenceAgeHours
        noSkippedChecks = $true
        installerEvidenceScope = 'MSI_INSTALL_FAIL_CLOSED_BOOTSTRAP_AND_UNINSTALL_ONLY'
        productionOperationalAcceptanceRequired = $true
        productionDeploymentEligible = $false
        operationalGatesNotExecutedByThisPipeline = @(
            'device-pairing-and-outbound-mtls',
            'signed-action-token-dispatch-and-ledger-reconciliation',
            'typed-host-and-erp-read-write-mutation-matrix',
            'restart-reconnect-replay-and-idempotency-matrix',
            'pause-cancel-owned-process-tree-and-late-completion-races',
            'unknown-outcome-needs-attention-and-recovery-matrix',
            'kill-switch-and-autopilot-disable-drills',
            'ring0-5-25-100-rollout-and-rollback-drills'
        )
    }
    files = $inventory
}
$manifest | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $manifestPath -Encoding utf8
New-DetachedCmsSignature -ContentPath $manifestPath -Certificate $signingCertificate -SignaturePath $manifestSignaturePath
Assert-DetachedCmsSignature -ContentPath $manifestPath -SignaturePath $manifestSignaturePath -ExpectedThumbprint $signerThumbprint | Out-Null
Assert-ManifestInventory -Root $candidatePath -Manifest $manifest

Get-ChildItem -LiteralPath $payloadRoot.FullName, $supportRoot.FullName -Recurse -File | Where-Object {
    $_.Extension -in '.exe', '.dll', '.sys', '.ps1', '.psm1', '.psd1'
} | ForEach-Object {
    Assert-AuthenticodeArtifact -SignToolPath $signTool -Path $_.FullName
}
Assert-AuthenticodeArtifact -SignToolPath $signTool -Path $msiPath -ExpectedThumbprint $signerThumbprint -RequireTimestamp

Write-Host "Signed release candidate created at $candidatePath"
Write-Host 'Status: AWAITING_SIGNED_DISPOSABLE_VM_ACCEPTANCE (not production deployable; operational gates remain red)'
[pscustomobject]@{
    CandidatePath = $candidatePath
    ManifestPath = $manifestPath
    Status = 'AWAITING_SIGNED_DISPOSABLE_VM_ACCEPTANCE'
}
