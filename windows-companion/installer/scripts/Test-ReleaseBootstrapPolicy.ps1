[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# This is a developer regression harness for the pre-import rejection paths.
# It does not establish the production entry-script trust boundary and does not
# claim that its temporary, intentionally modified entry scripts are trusted.
$installerRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$candidateSource = Join-Path $PSScriptRoot 'New-SignedReleaseCandidate.ps1'
$policySource = Join-Path $installerRoot 'release-policy.json'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('msaidizi-bootstrap-policy-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot -ErrorAction Stop | Out-Null
$utf8NoBom = [Text.UTF8Encoding]::new($false)
$passes = [Collections.Generic.List[string]]::new()

function Get-PolicyHash {
    param([Parameter(Mandatory)][string]$Path)
    $bytes = [IO.File]::ReadAllBytes($Path)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($hasher.ComputeHash($bytes)).Replace('-', '') }
    finally { $hasher.Dispose() }
}

function Find-TrustedTimestampedWindowsModule {
    $roots = @(
        (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\Modules'),
        (Join-Path $env:ProgramFiles 'WindowsPowerShell\Modules')
    )
    foreach ($file in Get-ChildItem -LiteralPath $roots -Recurse -File -Filter '*.psm1' -ErrorAction SilentlyContinue) {
        $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $file.FullName
        if ($signature.Status -eq [Management.Automation.SignatureStatus]::Valid -and
            $signature.SignerCertificate -and $signature.TimeStamperCertificate) {
            return [pscustomobject]@{
                Path = $file.FullName
                Signer = ($signature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant()
            }
        }
    }
    throw 'No trusted, timestamped Windows PowerShell module is available for bootstrap rejection tests.'
}

function New-BootstrapFixture {
    param(
        [Parameter(Mandatory)][string]$Name,
        [Parameter(Mandatory)][string]$EmbeddedPipelineSigner,
        [Parameter(Mandatory)][string]$PolicyPipelineSigner,
        [Parameter(Mandatory)][string]$PolicyReleaseSigner,
        [string]$ModuleSource,
        [switch]$TamperModule,
        [switch]$TamperPolicy
    )
    $root = Join-Path $fixtureRoot $Name
    $scripts = Join-Path $root 'scripts'
    New-Item -ItemType Directory -Path $scripts -ErrorAction Stop | Out-Null

    $policy = [IO.File]::ReadAllText($policySource, [Text.Encoding]::UTF8) |
        Microsoft.PowerShell.Utility\ConvertFrom-Json
    $policy.trust.pipelineSignerThumbprint = $PolicyPipelineSigner
    $policy.trust.releaseSignerThumbprint = $PolicyReleaseSigner
    $policy.dotnetHostSha256 = 'D' * 64
    $policy.sbomToolSha256 = 'E' * 64
    $policyPath = Join-Path $root 'release-policy.json'
    [IO.File]::WriteAllText(
        $policyPath,
        ($policy | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 20),
        $utf8NoBom)
    $policyHash = Get-PolicyHash -Path $policyPath

    $entryText = [IO.File]::ReadAllText($candidateSource, [Text.Encoding]::UTF8)
    $entryText = [regex]::Replace(
        $entryText,
        '(?m)^\$embeddedPipelineSignerThumbprint\s*=.*$',
        "`$embeddedPipelineSignerThumbprint = '$EmbeddedPipelineSigner'")
    $entryText = [regex]::Replace(
        $entryText,
        '(?m)^\$embeddedReleasePolicySha256\s*=.*$',
        "`$embeddedReleasePolicySha256 = '$policyHash'")
    $entryPath = Join-Path $scripts 'New-SignedReleaseCandidate.ps1'
    [IO.File]::WriteAllText($entryPath, $entryText, $utf8NoBom)

    $modulePath = Join-Path $scripts 'Release.Common.psm1'
    if ($ModuleSource) {
        [IO.File]::Copy($ModuleSource, $modulePath, $false)
    }
    else {
        [IO.File]::WriteAllText($modulePath, 'function Invoke-UnsignedFixture { }', $utf8NoBom)
    }
    if ($TamperModule) { [IO.File]::AppendAllText($modulePath, "`r`n# tampered", $utf8NoBom) }
    if ($TamperPolicy) { [IO.File]::AppendAllText($policyPath, ' ', $utf8NoBom) }

    return [pscustomobject]@{ Root = $root; Entry = $entryPath; Module = $modulePath }
}

function Assert-EntryRejected {
    param(
        [Parameter(Mandatory)]$Fixture,
        [Parameter(Mandatory)][string]$CallerReleaseSigner,
        [Parameter(Mandatory)][string]$ExpectedMessage,
        [Parameter(Mandatory)][string]$Case
    )
    try {
        & $Fixture.Entry `
            -Version '0.0.1' `
            -DotNetPath 'C:\bootstrap-fixture\dotnet.exe' `
            -SignToolPath 'C:\bootstrap-fixture\signtool.exe' `
            -SbomToolPath 'C:\bootstrap-fixture\sbom.exe' `
            -SbomToolSha256 ('F' * 64) `
            -DefenderCommandPath 'C:\bootstrap-fixture\mpcmdrun.exe' `
            -SigningCertificateThumbprint $CallerReleaseSigner `
            -TimestampUri 'https://timestamp.invalid/' `
            -SbomNamespaceBase 'https://sbom.invalid/'
        throw "Expected rejection did not occur: $Case"
    }
    catch {
        if ($_.Exception.Message -eq "Expected rejection did not occur: $Case") { throw }
        if ($_.Exception.Message -notmatch $ExpectedMessage) {
            throw "$Case returned an unexpected failure: $($_.Exception.Message)"
        }
        $script:passes.Add($Case)
    }
}

$trustedModule = Find-TrustedTimestampedWindowsModule
$pipelineSigner = $trustedModule.Signer
$releaseSigner = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

$unsigned = New-BootstrapFixture -Name 'unsigned-module' `
    -EmbeddedPipelineSigner $pipelineSigner -PolicyPipelineSigner $pipelineSigner `
    -PolicyReleaseSigner $releaseSigner
Assert-EntryRejected -Fixture $unsigned -CallerReleaseSigner $releaseSigner `
    -ExpectedMessage 'unsigned, tampered, expired/untrusted, untimestamped, or signed by the wrong' `
    -Case 'unsigned module is rejected before import'

$tampered = New-BootstrapFixture -Name 'tampered-module' `
    -EmbeddedPipelineSigner $pipelineSigner -PolicyPipelineSigner $pipelineSigner `
    -PolicyReleaseSigner $releaseSigner -ModuleSource $trustedModule.Path -TamperModule
Assert-EntryRejected -Fixture $tampered -CallerReleaseSigner $releaseSigner `
    -ExpectedMessage 'unsigned, tampered, expired/untrusted, untimestamped, or signed by the wrong' `
    -Case 'tampered signed module is rejected before import'

$wrongSigner = New-BootstrapFixture -Name 'wrong-module-signer' `
    -EmbeddedPipelineSigner ('1' * 40) -PolicyPipelineSigner ('1' * 40) `
    -PolicyReleaseSigner $releaseSigner -ModuleSource $trustedModule.Path
Assert-EntryRejected -Fixture $wrongSigner -CallerReleaseSigner $releaseSigner `
    -ExpectedMessage 'signed by the wrong embedded pipeline identity' `
    -Case 'valid timestamped module from the wrong signer is rejected before import'

$tamperedPolicy = New-BootstrapFixture -Name 'tampered-policy' `
    -EmbeddedPipelineSigner $pipelineSigner -PolicyPipelineSigner $pipelineSigner `
    -PolicyReleaseSigner $releaseSigner -TamperPolicy
Assert-EntryRejected -Fixture $tamperedPolicy -CallerReleaseSigner $releaseSigner `
    -ExpectedMessage 'differs from the exact digest embedded' `
    -Case 'tampered policy bytes are rejected before parsing'

$substitutedPolicySigner = New-BootstrapFixture -Name 'substituted-policy-signer' `
    -EmbeddedPipelineSigner ('1' * 40) -PolicyPipelineSigner ('2' * 40) `
    -PolicyReleaseSigner $releaseSigner
Assert-EntryRejected -Fixture $substitutedPolicySigner -CallerReleaseSigner $releaseSigner `
    -ExpectedMessage 'must pin real pipeline and release signer thumbprints' `
    -Case 'policy cannot substitute the embedded pipeline signer'

$callerSubstitution = New-BootstrapFixture -Name 'caller-release-signer-substitution' `
    -EmbeddedPipelineSigner $pipelineSigner -PolicyPipelineSigner $pipelineSigner `
    -PolicyReleaseSigner $releaseSigner
Assert-EntryRejected -Fixture $callerSubstitution -CallerReleaseSigner ('B' * 40) `
    -ExpectedMessage 'Caller-controlled release signer substitution was refused' `
    -Case 'caller cannot substitute the authenticated-policy release signer'

Write-Host "Release bootstrap-policy checks passed: $($passes.Count) cases."
Write-Host "Fixtures intentionally retained for inspection: $fixtureRoot"
