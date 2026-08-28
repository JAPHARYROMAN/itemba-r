[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Developer regression only. Production entry scripts authenticate this module
# before import; this test imports the workspace copy to exercise path behavior.
$modulePath = Join-Path $PSScriptRoot 'Release.Common.psm1'
Microsoft.PowerShell.Core\Import-Module $modulePath -Force

$passes = [Collections.Generic.List[string]]::new()
function Assert-Throws {
    param(
        [Parameter(Mandatory)][scriptblock]$Action,
        [Parameter(Mandatory)][string]$Case
    )
    try {
        & $Action
        throw "Expected rejection did not occur: $Case"
    }
    catch {
        if ($_.Exception.Message -eq "Expected rejection did not occur: $Case") { throw }
        $script:passes.Add($Case)
    }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('msaidizi-installer-path-policy-' + [guid]::NewGuid().ToString('N'))
$realOutput = Join-Path $testRoot 'real-output'
$realTools = Join-Path $testRoot 'real-tools'
New-Item -ItemType Directory -Path $realOutput, $realTools -ErrorAction Stop | Out-Null

$outputJunction = Join-Path $testRoot 'output-junction'
New-Item -ItemType Junction -Path $outputJunction -Target $realOutput -ErrorAction Stop | Out-Null
Assert-Throws -Case 'caller-supplied OutputRoot junction is rejected' -Action {
    Resolve-ExistingDirectoryPath -Path $outputJunction -Description 'test output root' | Out-Null
}

$toolPath = Join-Path $realTools 'tool.exe'
[IO.File]::WriteAllText($toolPath, 'not executable; path-policy fixture only')
$toolsJunction = Join-Path $testRoot 'tools-junction'
New-Item -ItemType Junction -Path $toolsJunction -Target $realTools -ErrorAction Stop | Out-Null
Assert-Throws -Case 'tool beneath a reparse component is rejected' -Action {
    Resolve-ExistingLeafPath -Path (Join-Path $toolsJunction 'tool.exe') -Description 'test tool' | Out-Null
}

$candidate = Join-Path $realOutput 'candidate'
New-Item -ItemType Directory -Path $candidate -ErrorAction Stop | Out-Null
foreach ($leaf in @('payload', 'package', 'evidence', 'support')) {
    New-Item -ItemType Directory -Path (Join-Path $candidate $leaf) -ErrorAction Stop | Out-Null
}
Assert-VerifiedCandidateLayout -OutputRoot $realOutput -CandidateRoot $candidate
$passes.Add('exact same-volume candidate layout is accepted')

$otherParent = Join-Path $testRoot 'other-parent'
New-Item -ItemType Directory -Path $otherParent -ErrorAction Stop | Out-Null
Assert-Throws -Case 'candidate with a different resolved parent is rejected' -Action {
    Assert-VerifiedDirectChildDirectory -Parent $otherParent -Child $candidate -ExpectedLeafName 'candidate' | Out-Null
}

$payload = Join-Path $candidate 'payload'
$hardLinkPublish = Join-Path $payload 'HardLinkService'
New-Item -ItemType Directory -Path $hardLinkPublish -ErrorAction Stop | Out-Null
$hardLinkConfig = Join-Path $hardLinkPublish 'appsettings.json'
$hardLinkAlias = Join-Path $testRoot 'config-hardlink-alias.json'
[IO.File]::WriteAllText($hardLinkConfig, '{}')
New-Item -ItemType HardLink -Path $hardLinkAlias -Target $hardLinkConfig -ErrorAction Stop | Out-Null
Assert-Throws -Case 'multiply-linked staged configuration is not deleted' -Action {
    Remove-VerifiedStagedConfiguration -PayloadRoot $payload -PublishDirectory $hardLinkPublish -Path $hardLinkConfig
}
if (-not (Test-Path -LiteralPath $hardLinkConfig -PathType Leaf) -or
    -not (Test-Path -LiteralPath $hardLinkAlias -PathType Leaf)) {
    throw 'Hard-link rejection altered a path-policy fixture.'
}
$passes.Add('hard-link rejection preserves both names')

$exactPublish = Join-Path $payload 'ExactService'
New-Item -ItemType Directory -Path $exactPublish -ErrorAction Stop | Out-Null
$exactConfig = Join-Path $exactPublish 'appsettings.json'
[IO.File]::WriteAllText($exactConfig, '{}')
Remove-VerifiedStagedConfiguration -PayloadRoot $payload -PublishDirectory $exactPublish -Path $exactConfig
if (Test-Path -LiteralPath $exactConfig) {
    throw 'Exact staged configuration was not removed.'
}
$passes.Add('single-link exact staged configuration is removed by locked handle')

Write-Host "Release path-policy checks passed: $($passes.Count) cases."
Write-Host "Fixtures intentionally retained for inspection: $testRoot"
