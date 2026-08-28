[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Developer regression only. Production entry scripts authenticate this module
# before import and separately require Microsoft Authenticode for trusted tools.
Microsoft.PowerShell.Core\Import-Module (Join-Path $PSScriptRoot 'Release.Common.psm1') -Force

$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('msaidizi-tool-trust-policy-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixtureRoot -ErrorAction Stop | Out-Null
$tool = Join-Path $fixtureRoot 'tool.exe'
[IO.File]::WriteAllText($tool, 'tool-hash-fixture-v1')
$expected = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $tool -Algorithm SHA256).Hash
$passes = [Collections.Generic.List[string]]::new()

function Assert-Throws {
    param([Parameter(Mandatory)][scriptblock]$Action, [Parameter(Mandatory)][string]$Case)
    try {
        & $Action
        throw "Expected rejection did not occur: $Case"
    }
    catch {
        if ($_.Exception.Message -eq "Expected rejection did not occur: $Case") { throw }
        $script:passes.Add($Case)
    }
}

$accepted = Assert-AuthenticatedToolHash -Path $tool -PolicySha256 $expected `
    -ClaimedSha256 $expected -Description 'test tool'
if ($accepted -cne $expected) { throw 'Exact authenticated tool hash was not returned.' }
$passes.Add('exact policy, caller assertion, and file hash agree')

Assert-Throws -Case 'caller cannot substitute the SBOM/tool hash' -Action {
    Assert-AuthenticatedToolHash -Path $tool -PolicySha256 $expected `
        -ClaimedSha256 ('A' * 64) -Description 'test tool' | Out-Null
}

Assert-Throws -Case 'unprovisioned policy hash fails closed' -Action {
    Assert-AuthenticatedToolHash -Path $tool -PolicySha256 'PROVISIONING_REQUIRED' `
        -ClaimedSha256 $expected -Description 'test tool' | Out-Null
}

[IO.File]::WriteAllText($tool, 'tool-hash-fixture-tampered')
Assert-Throws -Case 'tool bytes changed after policy pinning are rejected' -Action {
    Assert-AuthenticatedToolHash -Path $tool -PolicySha256 $expected `
        -ClaimedSha256 $expected -Description 'test tool' | Out-Null
}

Write-Host "Release tool-trust-policy checks passed: $($passes.Count) cases."
Write-Host "Fixtures intentionally retained for inspection: $fixtureRoot"
