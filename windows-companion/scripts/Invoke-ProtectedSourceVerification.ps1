[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [ValidateNotNullOrEmpty()]
  [string]$DotNetPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if ($PSVersionTable.PSEdition -cne 'Core' -or
    $PSVersionTable.PSVersion.Major -ne 7 -or
    $PSVersionTable.PSVersion.Minor -lt 4) {
  throw 'Protected Windows companion verification requires PowerShell Core 7.4 or newer in the 7.x release line.'
}

if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
  throw 'Protected Windows companion verification must run on Windows.'
}

$companionRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$solutionPath = Join-Path $companionRoot 'Msaidizi.WindowsCompanion.sln'
$globalJsonPath = Join-Path $companionRoot 'global.json'
$dotnetItem = Get-Item -LiteralPath ([IO.Path]::GetFullPath($DotNetPath)) -Force -ErrorAction Stop
if ($dotnetItem.PSIsContainer) {
  throw 'DotNetPath must resolve to the dotnet executable.'
}

$dotnet = $dotnetItem.FullName
$sdkPolicy = Get-Content -LiteralPath $globalJsonPath -Raw -Encoding utf8 |
  Microsoft.PowerShell.Utility\ConvertFrom-Json
$requiredSdkVersion = [string]$sdkPolicy.sdk.version
$actualSdkVersion = (& $dotnet --version 2>&1 | ForEach-Object { $_.ToString() }) -join ''
if ($LASTEXITCODE -ne 0 -or $actualSdkVersion.Trim() -cne $requiredSdkVersion) {
  throw "Protected verification requires exact .NET SDK $requiredSdkVersion; found '$($actualSdkVersion.Trim())'."
}

function Invoke-CheckedDotNet {
  param(
    [Parameter(Mandatory)][string]$Description,
    [Parameter(Mandatory)][string[]]$Arguments
  )

  Write-Host "[$Description] $dotnet $($Arguments -join ' ')"
  & $dotnet @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Description failed with exit code $LASTEXITCODE."
  }
}

function Invoke-HashPinnedPowerShellScript {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][ValidatePattern('^[0-9A-F]{64}$')][string]$ExpectedSha256,
    [Parameter(Mandatory)][string]$Description,
    [switch]$RequireRoslyn,
    [switch]$PassDotNetPath
  )

  $resolvedPath = [IO.Path]::GetFullPath($Path)
  $readLock = [IO.File]::Open(
    $resolvedPath,
    [IO.FileMode]::Open,
    [IO.FileAccess]::Read,
    [IO.FileShare]::Read)
  try {
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
      $actualSha256 = [BitConverter]::ToString($hasher.ComputeHash($readLock)).Replace('-', '')
    }
    finally {
      $hasher.Dispose()
    }
    if ($actualSha256 -cne $ExpectedSha256) {
      throw "$Description bytes do not match the protected verification runner."
    }

    Write-Host "[$Description] $resolvedPath$(if ($RequireRoslyn) { ' -RequireRoslyn' })$(if ($PassDotNetPath) { ' -DotNetPath <PINNED>' })"
    if ($RequireRoslyn) {
      & $resolvedPath -RequireRoslyn
    }
    elseif ($PassDotNetPath) {
      & $resolvedPath -DotNetPath $dotnet
    }
    else {
      & $resolvedPath
    }
    if (-not $?) {
      throw "$Description failed."
    }
  }
  finally {
    $readLock.Dispose()
  }
}

# These hashes are part of this runner's reviewed bytes. The signed release
# policy separately pins this runner, so neither downstream static verifier can
# be changed between review and execution without failing closed.
$companionStaticSha256 = '00BE7EA968CCD930DA10BDEBF5B3613D22D7DDFEDD333973073D70C0158B79A7'
$installerStaticSha256 = '2B0A946CB3E63D98A13B243ADB217908A51DEF0B009633C8395B8E322F28D4FB'
$releaseBootstrapPolicySha256 = 'B3407BFE7FB5DB1A009E22C45FF2E6A3B65670EB5B73DE01A02D4F3B59D318BE'
$releasePathPolicySha256 = 'B59396510B3A7F81FB8AAA55F99E5294D8202F052820727423BEED72CE81943E'
$releaseToolTrustPolicySha256 = '8AB9DE275A74BFBA95F1EC34F291553A8C70264260906AE0A799F9DFF6DF0221'
$operationalEvidencePolicySha256 = 'D36B6BE846B410E52612B91C01AFCEDB68B207B07AF6877FAB1CC140102D9D5D'
$productionPrerequisiteInventoryPolicySha256 = 'EFD6EF99A1AA87E5CF25043BA8C1558FF0320F226F18C0D1ADF4303609F994EF'
$networkIsolationProtocolSha256 = 'E860F33C52B2C37874A352DCBB12243E759B93319B00C0635DF57C1F41EB92A1'
$companionStaticPath = Join-Path $companionRoot 'scripts\verify-static.ps1'
$installerStaticPath = Join-Path $companionRoot 'installer\scripts\Test-InstallerStatic.ps1'
$releaseBootstrapPolicyPath = Join-Path $companionRoot 'installer\scripts\Test-ReleaseBootstrapPolicy.ps1'
$releasePathPolicyPath = Join-Path $companionRoot 'installer\scripts\Test-ReleasePathPolicy.ps1'
$releaseToolTrustPolicyPath = Join-Path $companionRoot 'installer\scripts\Test-ReleaseToolTrustPolicy.ps1'
$operationalEvidencePolicyPath = Join-Path $companionRoot 'installer\scripts\Test-OperationalEvidencePolicy.ps1'
$productionPrerequisiteInventoryPolicyPath = Join-Path $companionRoot 'installer\scripts\Test-ProductionPrerequisiteInventory.ps1'
$networkIsolationProtocolPath = Join-Path $companionRoot `
  'native\Msaidizi.NetworkIsolationDriver\tests\verify-protocol.ps1'
$installerHardeningTestProject = Join-Path $companionRoot `
  'installer\tests\Itemba.Msaidizi.Installer.Hardening.Tests\Itemba.Msaidizi.Installer.Hardening.Tests.csproj'

$previousCi = $env:CI
$previousTelemetry = $env:DOTNET_CLI_TELEMETRY_OPTOUT
$previousNoLogo = $env:DOTNET_NOLOGO
$env:CI = 'true'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$env:DOTNET_NOLOGO = '1'
Push-Location $companionRoot
try {
  Invoke-CheckedDotNet -Description 'restore Windows companion solution' -Arguments @(
    'restore', $solutionPath, '--nologo'
  )
  Invoke-CheckedDotNet -Description 'verify Windows companion formatting' -Arguments @(
    'format', $solutionPath, '--verify-no-changes', '--no-restore'
  )
  Invoke-CheckedDotNet -Description 'build Windows companion solution' -Arguments @(
    'build', $solutionPath, '-c', 'Release', '--no-restore', '--nologo'
  )
  # ProcessTiming is excluded here and run by a separate, dedicated job.
  #
  # Those tests spawn real process trees and assert on wall-clock budgets - a
  # five-second command timeout, "elapsed under eight seconds", millisecond pipe
  # deadlines. On a shared, virtualised runner the budget is spent on process
  # startup rather than on the behaviour under test, so they fail for reasons
  # unrelated to the code. Keeping them in this gate would make the required
  # check report the runner's load rather than the source's correctness, and a
  # gate that fails at random is a gate people learn to re-run rather than read.
  #
  # They are NOT dropped: `windows-companion-timing` runs exactly this category.
  # Excluding by an explicit category also means a new timing-dependent test is
  # in this gate by default and has to be opted out deliberately.
  Invoke-CheckedDotNet -Description 'test Windows companion solution' -Arguments @(
    'test', $solutionPath, '-c', 'Release', '--no-build', '--no-restore', '--nologo',
    '--filter', 'Category!=ProcessTiming'
  )
  Invoke-CheckedDotNet -Description 'restore installer hardening tests from lock files' -Arguments @(
    'restore', $installerHardeningTestProject, '--locked-mode', '--nologo'
  )
  Invoke-CheckedDotNet -Description 'verify installer hardening formatting' -Arguments @(
    'format', $installerHardeningTestProject, '--verify-no-changes', '--no-restore'
  )
  Invoke-CheckedDotNet -Description 'build installer hardening tests' -Arguments @(
    'build', $installerHardeningTestProject, '-c', 'Release', '--no-restore', '--nologo'
  )
  Invoke-CheckedDotNet -Description 'test installer hardening boundary' -Arguments @(
    'test', $installerHardeningTestProject, '-c', 'Release', '--no-build', '--no-restore', '--nologo'
  )
  Invoke-HashPinnedPowerShellScript -Path $companionStaticPath `
    -ExpectedSha256 $companionStaticSha256 -Description 'verify companion security boundaries' `
    -RequireRoslyn
  Invoke-HashPinnedPowerShellScript -Path $installerStaticPath `
    -ExpectedSha256 $installerStaticSha256 -Description 'verify installer and release authoring'
  Invoke-HashPinnedPowerShellScript -Path $releaseBootstrapPolicyPath `
    -ExpectedSha256 $releaseBootstrapPolicySha256 -Description 'verify release bootstrap policy dynamically'
  Invoke-HashPinnedPowerShellScript -Path $releasePathPolicyPath `
    -ExpectedSha256 $releasePathPolicySha256 -Description 'verify release path policy dynamically'
  Invoke-HashPinnedPowerShellScript -Path $releaseToolTrustPolicyPath `
    -ExpectedSha256 $releaseToolTrustPolicySha256 -Description 'verify release tool trust policy dynamically'
  Invoke-HashPinnedPowerShellScript -Path $operationalEvidencePolicyPath `
    -ExpectedSha256 $operationalEvidencePolicySha256 `
    -Description 'verify operational evidence policy dynamically' -PassDotNetPath
  Invoke-HashPinnedPowerShellScript -Path $productionPrerequisiteInventoryPolicyPath `
    -ExpectedSha256 $productionPrerequisiteInventoryPolicySha256 `
    -Description 'verify production prerequisite inventory dynamically'
  Invoke-HashPinnedPowerShellScript -Path $networkIsolationProtocolPath `
    -ExpectedSha256 $networkIsolationProtocolSha256 `
    -Description 'verify native network-isolation protocol and source contract'
}
finally {
  Pop-Location
  $env:CI = $previousCi
  $env:DOTNET_CLI_TELEMETRY_OPTOUT = $previousTelemetry
  $env:DOTNET_NOLOGO = $previousNoLogo
}

Write-Host 'Protected Windows companion source verification passed.'
