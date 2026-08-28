[CmdletBinding()]
param([string]$DotNetPath)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot 'Approve-OperationalRelease.ps1'
$operationalSchemaPath = Join-Path (Join-Path $PSScriptRoot '..') 'operational\operational-acceptance.schema.json'
$providerVerifierProjectPath = Join-Path (Join-Path $PSScriptRoot '..') 'src\Itemba.Msaidizi.ProviderContractVerifier\Itemba.Msaidizi.ProviderContractVerifier.csproj'
$fixtureGeneratorProjectPath = Join-Path (Join-Path $PSScriptRoot '..') 'tests\Itemba.Msaidizi.ProviderContractFixtureGenerator\Itemba.Msaidizi.ProviderContractFixtureGenerator.csproj'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ("msaidizi-operational-policy-" + [Guid]::NewGuid().ToString('N'))
$releaseSigner = '1' * 40
$operationalSigner = '2' * 40
$ringSigner = '3' * 40
$msiSha256 = '4' * 64
$sourceRevision = 'abcdef0123456789'
$version = '1.2.3'

$operationalSchema = Get-Content -LiteralPath $operationalSchemaPath -Raw -Encoding utf8 | ConvertFrom-Json
$reviewedCheckCount = @($operationalSchema.properties.checks.items.properties.id.enum).Count
if ($reviewedCheckCount -ne 15 -or
    [int]$operationalSchema.properties.checks.minItems -ne $reviewedCheckCount -or
    [int]$operationalSchema.properties.checks.maxItems -ne $reviewedCheckCount) {
    throw 'Operational evidence schema check cardinality must equal the exact 15-item reviewed set.'
}
if ([int]$operationalSchema.properties.artifacts.minItems -ne 18) {
    throw 'Operational evidence schema artifact minimum must match the production verifier minimum of 18.'
}
if ($operationalSchema.properties.providerContract.additionalProperties -ne $false -or
    @($operationalSchema.properties.providerContract.required).Count -ne 20 -or
    [string]$operationalSchema.properties.providerContract.properties.apiOrigin.const -cne 'https://api.anthropic.com') {
    throw 'Operational evidence schema must require the exact strict provider-contract binding and API origin.'
}

function Get-TestSha256 {
    param([Parameter(Mandatory)][string]$Value)
    $hasher = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($hasher.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))) -replace '-', '').ToLowerInvariant()
    }
    finally { $hasher.Dispose() }
}

function Write-TestJson {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)]$Value)
    $Value | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $Path -Encoding utf8
}

function New-CheckArtifacts {
    param([Parameter(Mandatory)][string[]]$Ids, [Parameter(Mandatory)][string]$Prefix)
    $checks = [Collections.Generic.List[object]]::new()
    $artifacts = [Collections.Generic.List[object]]::new()
    foreach ($id in $Ids) {
        $sha256 = Get-TestSha256 "$Prefix/$id"
        $checks.Add([ordered]@{ id = $id; status = 'PASS'; artifactSha256 = $sha256 })
        $artifacts.Add([ordered]@{
            name = "$Prefix-$id"
            sha256 = $sha256
            immutableReference = "test-evidence://$Prefix/$id"
        })
    }
    return [pscustomobject]@{ Checks = $checks; Artifacts = $artifacts }
}

function New-TestCase {
    param([Parameter(Mandatory)][string]$Name, [scriptblock]$Mutate)
    $root = Join-Path $testRoot $Name
    $candidate = Join-Path $root 'candidate'
    New-Item -ItemType Directory -Path $candidate -Force | Out-Null
    $payloadPath = Join-Path $candidate 'payload.bin'
    Set-Content -LiteralPath $payloadPath -Value 'signed-payload' -Encoding ascii
    $providerVerifierDestination = Join-Path $candidate 'support\ProviderContractVerifier'
    New-Item -ItemType Directory -Path $providerVerifierDestination -Force | Out-Null
    Copy-Item -Path (Join-Path $script:providerVerifierBuild '*') `
        -Destination $providerVerifierDestination -Recurse -Force
    $candidateInventory = @(Get-ChildItem -LiteralPath $candidate -Recurse -File | ForEach-Object {
        [ordered]@{
            path = $_.FullName.Substring($candidate.Length + 1).Replace('\', '/')
            size = $_.Length
            sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    })
    $manifestPath = Join-Path $candidate 'release-manifest.json'
    Write-TestJson $manifestPath ([ordered]@{
        schemaVersion = 1
        status = 'AWAITING_SIGNED_DISPOSABLE_VM_ACCEPTANCE'
        codeSigningThumbprint = $releaseSigner
        version = $version
        sourceRevision = $sourceRevision
        msi = [ordered]@{ sha256 = $msiSha256 }
        files = $candidateInventory
    })
    Set-Content -LiteralPath "$manifestPath.p7s" -Value 'test-signature' -Encoding ascii
    $manifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $installerApprovalPath = Join-Path $candidate 'installer-vm-accepted.json'
    Write-TestJson $installerApprovalPath ([ordered]@{
        schemaVersion = 1
        status = 'INSTALLER_VM_ACCEPTED_AWAITING_OPERATIONAL_COMPANION_ACCEPTANCE'
        productionDeploymentEligible = $false
        releaseManifestSha256 = $manifestSha256
        version = $version
        sourceRevision = $sourceRevision
        msiSha256 = $msiSha256
        gates = [ordered]@{
            operationalCompanionAcceptance = 'NOT_EXECUTED'
            productionRingAcceptance = 'NOT_EXECUTED'
        }
    })
    Set-Content -LiteralPath "$installerApprovalPath.p7s" -Value 'test-signature' -Encoding ascii
    $installerApprovalSha256 = (Get-FileHash -LiteralPath $installerApprovalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $binding = [ordered]@{
        installerVmApprovalSha256 = $installerApprovalSha256
        releaseManifestSha256 = $manifestSha256
        version = $version
        sourceRevision = $sourceRevision
        msiSha256 = $msiSha256
    }

    $operationalCheckIds = @(
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
    $now = [DateTimeOffset]::UtcNow.AddSeconds(-5)
    $operationalCompleted = $now.AddHours(-168)
    $operationalWindowStart = $operationalCompleted.AddHours(-1)
    $providerRoot = Join-Path $root 'provider-contract-test-artifacts'
    & $script:fixtureGeneratorExe '--output' $providerRoot `
        '--window-start-utc' $operationalWindowStart.ToUniversalTime().ToString('O') `
        '--expires-at-utc' $now.AddDays(30).ToUniversalTime().ToString('O')
    if ($LASTEXITCODE -ne 0) { throw 'Ephemeral provider-contract fixture generator failed.' }
    $providerBindingJson = Get-Content -LiteralPath (
        Join-Path $providerRoot 'test-provider-contract-binding.json') -Raw -Encoding utf8
    $jsonConverter = Get-Command ConvertFrom-Json -ErrorAction Stop
    $providerBinding = if ($jsonConverter.Parameters.ContainsKey('DateKind')) {
        $providerBindingJson | ConvertFrom-Json -DateKind String
    }
    else {
        $providerBindingJson | ConvertFrom-Json
    }
    $providerAttestationPath = Join-Path $providerRoot 'test-provider-contract-attestation.json'
    $providerPublicKeyPath = Join-Path $providerRoot 'test-provider-contract-public.pem'
    $providerDocumentPath = Join-Path $providerRoot 'test-provider-contract-document.bin'
    $operationalMaterial = New-CheckArtifacts -Ids $operationalCheckIds -Prefix 'operational'
    foreach ($providerCheckMaterial in @($operationalMaterial.Checks)) {
        if ([string]$providerCheckMaterial.id -ceq 'provider-zero-training-and-zero-retention-contract') {
            $providerCheckMaterial.artifactSha256 = [string]$providerBinding.attestationArtifactSha256
        }
    }
    foreach ($providerArtifactMaterial in @($operationalMaterial.Artifacts)) {
        if ([string]$providerArtifactMaterial.name -ceq 'operational-provider-zero-training-and-zero-retention-contract') {
            $providerArtifactMaterial.sha256 = [string]$providerBinding.attestationArtifactSha256
        }
    }
    $operationalChecks = @($operationalMaterial.Checks | ForEach-Object {
        [ordered]@{
            id = $_.id
            status = $_.status
            startedAtUtc = $operationalWindowStart.ToString('O')
            completedAtUtc = $operationalCompleted.ToString('O')
            artifactSha256 = $_.artifactSha256
        }
    })
    $operational = [ordered]@{
        schemaVersion = 1
        status = 'PASS_AWAITING_RING_ACCEPTANCE'
        evidenceScope = 'FULL_COMPANION_OPERATIONAL_ACCEPTANCE'
        productionDeploymentEligible = $false
        acceptanceRunId = [Guid]::NewGuid().ToString('D')
        completedAtUtc = $operationalCompleted.ToString('O')
        signerThumbprint = $operationalSigner
        release = $binding
        providerContract = $providerBinding
        devices = @([ordered]@{
            deviceId = [Guid]::NewGuid().ToString('D')
            enrollmentId = [Guid]::NewGuid().ToString('D')
            deviceIdentitySha256 = Get-TestSha256 'device-identity'
            tpmAttestationSha256 = Get-TestSha256 'tpm-attestation'
            osBuild = 26100
            architecture = 'x64'
            fileSystem = 'NTFS'
            status = 'PASS'
        })
        checks = $operationalChecks
        counters = [ordered]@{
            duplicateMutations = 0
            duplicateExternalActions = 0
            unknownWritesAutomaticallyRetried = 0
            lateCompletionsOverwritingCancellation = 0
            journalLedgerReconciliationMismatches = 0
            credentialPersistenceFindings = 0
            unplannedPromptInjectionSteps = 0
            dispatchesAfterKillSwitch = 0
            unrecoveredReversibleActions = 0
        }
        noSkippedChecks = $true
        artifacts = @($operationalMaterial.Artifacts) + @(
            [ordered]@{
                name = 'device-tpm-attestation'
                sha256 = Get-TestSha256 'tpm-attestation'
                immutableReference = 'test-evidence://device/tpm-attestation'
            },
            [ordered]@{
                name = 'provider-contract-public-key'
                sha256 = [string]$providerBinding.publicKeyArtifactSha256
                immutableReference = 'test-evidence://provider-contract/public-key'
            },
            [ordered]@{
                name = 'provider-contract-document'
                sha256 = [string]$providerBinding.contractDocumentSha256
                immutableReference = 'test-evidence://provider-contract/document'
            }
        )
    }
    $operationalPath = Join-Path $root 'operational.json'
    Write-TestJson $operationalPath $operational
    $operationalSha256 = (Get-FileHash -LiteralPath $operationalPath -Algorithm SHA256).Hash.ToLowerInvariant()

    $ringCheckIds = @(
        'rollout-health', 'audit-ledger-reconciliation', 'recovery-drill',
        'central-kill-switch', 'device-kill-switch', 'global-autopilot-disable',
        'autonomous-update-rollback', 'no-duplicate-mutation-or-external-action'
    )
    $ringNames = @('RING_0', 'RING_5', 'RING_25', 'RING_100')
    $ringPercents = @(0, 5, 25, 100)
    $healthHours = @(24, 24, 48, 72)
    $rings = [Collections.Generic.List[object]]::new()
    $ringArtifacts = [Collections.Generic.List[object]]::new()
    $ringStart = $operationalCompleted
    for ($index = 0; $index -lt 4; $index++) {
        $material = New-CheckArtifacts -Ids $ringCheckIds -Prefix $ringNames[$index]
        foreach ($artifact in $material.Artifacts) { $ringArtifacts.Add($artifact) }
        $ringEnd = $ringStart.AddHours($healthHours[$index])
        $population = 20
        $targeted = if ($index -eq 0) { 1 } else { [int][Math]::Ceiling($population * $ringPercents[$index] / 100.0) }
        $deviceSetSha256 = Get-TestSha256 "devices-$index"
        $ringArtifacts.Add([ordered]@{
            name = "$($ringNames[$index])-target-device-set"
            sha256 = $deviceSetSha256
            immutableReference = "test-evidence://$($ringNames[$index])/target-device-set"
        })
        $rings.Add([ordered]@{
            name = $ringNames[$index]
            sequence = $index
            targetPercent = $ringPercents[$index]
            status = 'PASS'
            enrolledPopulation = $population
            targetedDeviceCount = $targeted
            observedHealthyDeviceCount = $targeted
            targetDeviceSetSha256 = $deviceSetSha256
            startedAtUtc = $ringStart.ToString('O')
            completedAtUtc = $ringEnd.ToString('O')
            observedHealthHours = $healthHours[$index]
            checks = @($material.Checks)
            counters = [ordered]@{
                failedDevices = 0
                unhealthyDevices = 0
                reconciliationMismatches = 0
                dispatchesAfterKillSwitch = 0
                rollbackFailures = 0
                duplicateMutations = 0
                duplicateExternalActions = 0
            }
        })
        $ringStart = $ringEnd
    }
    $ringEvidence = [ordered]@{
        schemaVersion = 1
        status = 'PASS'
        productionDeploymentEligible = $true
        acceptanceRunId = [Guid]::NewGuid().ToString('D')
        completedAtUtc = $ringStart.ToString('O')
        signerThumbprint = $ringSigner
        operationalEvidenceSha256 = $operationalSha256
        release = $binding
        rings = @($rings)
        noSkippedChecks = $true
        artifacts = @($ringArtifacts)
    }
    if ($Mutate) { & $Mutate $operational $ringEvidence }
    Write-TestJson $operationalPath $operational
    $ringEvidence.operationalEvidenceSha256 = (Get-FileHash -LiteralPath $operationalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $ringPath = Join-Path $root 'rings.json'
    Write-TestJson $ringPath $ringEvidence
    $operationalSignaturePath = "$operationalPath.p7s"
    $ringSignaturePath = "$ringPath.p7s"
    Set-Content -LiteralPath $operationalSignaturePath -Value 'test-signature' -Encoding ascii
    Set-Content -LiteralPath $ringSignaturePath -Value 'test-signature' -Encoding ascii
    return [pscustomobject]@{
        Root = $root
        Candidate = $candidate
        Operational = $operationalPath
        OperationalSignature = $operationalSignaturePath
        Ring = $ringPath
        RingSignature = $ringSignaturePath
        ProviderAttestation = $providerAttestationPath
        ProviderPublicKey = $providerPublicKeyPath
        ProviderDocument = $providerDocumentPath
    }
}

function Invoke-TestCase {
    param([Parameter(Mandatory)]$Fixture, [Parameter(Mandatory)][bool]$ShouldPass, [Parameter(Mandatory)][string]$Name)
    $savedPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & powershell -NoLogo -NoProfile -NonInteractive -File $script:testEntry `
            -CandidatePath $Fixture.Candidate `
            -OperationalEvidencePath $Fixture.Operational `
            -OperationalEvidenceSignaturePath $Fixture.OperationalSignature `
            -RingEvidencePath $Fixture.Ring `
            -RingEvidenceSignaturePath $Fixture.RingSignature `
            -ProviderContractAttestationPath $Fixture.ProviderAttestation `
            -ProviderContractPublicKeyPath $Fixture.ProviderPublicKey `
            -ProviderContractDocumentPath $Fixture.ProviderDocument `
            -ExpectedOperationalEvidenceSignerThumbprint $operationalSigner `
            -ExpectedRingEvidenceSignerThumbprint $ringSigner `
            -ReleaseSigningCertificateThumbprint $releaseSigner 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally { $ErrorActionPreference = $savedPreference }
    $passed = $exitCode -eq 0
    if ($passed -ne $ShouldPass) {
        throw "$Name expected pass=$ShouldPass, got pass=$passed. Output: $($output -join [Environment]::NewLine)"
    }
    $approval = Join-Path $Fixture.Candidate 'production-accepted.json'
    if ($ShouldPass -and -not (Test-Path -LiteralPath $approval -PathType Leaf)) {
        throw "$Name passed without producing a production acceptance record."
    }
    if ($ShouldPass) {
        $accepted = Get-Content -LiteralPath $approval -Raw -Encoding utf8 | ConvertFrom-Json
        $operational = Get-Content -LiteralPath $Fixture.Operational -Raw -Encoding utf8 | ConvertFrom-Json
        if ([string]$accepted.providerContract.attestationArtifactSha256 -cne [string]$operational.providerContract.attestationArtifactSha256 -or
            [string]$accepted.providerContract.signerSpkiSha256 -cne [string]$operational.providerContract.signerSpkiSha256 -or
            -not $accepted.gates.providerContractCryptographicallyVerified -or
            -not $accepted.gates.providerContractCoversOperationalAndRingWindow) {
            throw "$Name produced a production record without the exact verified provider-contract projection."
        }
    }
    if (-not $ShouldPass -and (Test-Path -LiteralPath $approval)) {
        throw "$Name failed after producing a production acceptance record."
    }
    Write-Host "PASS: $Name"
}

$originalDotNetRoot = $env:DOTNET_ROOT
New-Item -ItemType Directory -Path $testRoot -ErrorAction Stop | Out-Null
try {
    if (-not $DotNetPath) {
        $DotNetPath = (Get-Command dotnet -ErrorAction Stop).Source
    }
    $resolvedDotNet = (Get-Item -LiteralPath $DotNetPath -Force -ErrorAction Stop).FullName
    $env:DOTNET_ROOT = Split-Path -Parent $resolvedDotNet
    $script:providerVerifierBuild = Join-Path $testRoot 'provider-verifier-build'
    $fixtureGeneratorBuild = Join-Path $testRoot 'provider-fixture-generator-build'
    & $resolvedDotNet publish $providerVerifierProjectPath -c Release -r win-x64 `
        --self-contained false -p:SelfContained=false `
        -o $script:providerVerifierBuild
    if ($LASTEXITCODE -ne 0) { throw 'Failed to build the real provider-contract verifier for operational policy tests.' }
    & $resolvedDotNet publish $fixtureGeneratorProjectPath -c Release -r win-x64 `
        --self-contained false -o $fixtureGeneratorBuild
    if ($LASTEXITCODE -ne 0) { throw 'Failed to build the ephemeral provider-contract fixture generator.' }
    $script:fixtureGeneratorExe = Join-Path $fixtureGeneratorBuild 'Itemba.Msaidizi.ProviderContractFixtureGenerator.exe'
    if (-not (Test-Path -LiteralPath $script:fixtureGeneratorExe -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $script:providerVerifierBuild 'Itemba.Msaidizi.ProviderContractVerifier.exe') -PathType Leaf)) {
        throw 'Provider-contract test tools did not emit the expected Windows executables.'
    }

    $source = [IO.File]::ReadAllText($sourcePath, [Text.Encoding]::UTF8)
    $start = $source.IndexOf('$embeddedPipelineSignerThumbprint', [StringComparison]::Ordinal)
    $end = $source.IndexOf('function Assert-ExactPropertySet', [StringComparison]::Ordinal)
    if ($start -lt 0 -or $end -le $start) { throw 'Operational entry script validation boundary changed; test harness refused to bypass an unknown region.' }
    $testPrelude = @'
$policy = [pscustomobject]@{
    maximumOperationalEvidenceAgeHours = 720
    maximumRingEvidenceAgeHours = 168
    minimumRingHealthHours = [pscustomobject]@{ RING_0 = 24; RING_5 = 24; RING_25 = 48; RING_100 = 72 }
}
$pinnedReleaseSigner = ($ReleaseSigningCertificateThumbprint -replace '\s', '').ToUpperInvariant()
$requestedOperationalSigner = ($ExpectedOperationalEvidenceSignerThumbprint -replace '\s', '').ToUpperInvariant()
$requestedRingSigner = ($ExpectedRingEvidenceSignerThumbprint -replace '\s', '').ToUpperInvariant()
$releaseCertificate = $null
function Resolve-ExistingDirectoryPath { param([string]$Path, [string]$Description) return (Get-Item -LiteralPath $Path -Force -ErrorAction Stop).FullName }
function Resolve-ExistingLeafPath { param([string]$Path, [string]$Description) return (Get-Item -LiteralPath $Path -Force -ErrorAction Stop).FullName }
function Assert-DetachedCmsSignature { param([string]$ContentPath, [string]$SignaturePath, [string]$ExpectedThumbprint) }
function Assert-ManifestInventory { param([string]$Root, $Manifest) }
function New-DetachedCmsSignature { param([string]$ContentPath, $Certificate, [string]$SignaturePath) Set-Content -LiteralPath $SignaturePath -Value 'test-signature' -Encoding ascii }
'@
    $testSource = $source.Substring(0, $start) + $testPrelude + "`r`n" + $source.Substring($end)
    $script:testEntry = Join-Path $testRoot 'Approve-OperationalRelease.test.ps1'
    [IO.File]::WriteAllText($script:testEntry, $testSource, [Text.UTF8Encoding]::new($false))
    $parseErrors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($script:testEntry, [ref]$null, [ref]$parseErrors)
    if (@($parseErrors).Count -ne 0) { throw "Generated validation harness does not parse: $($parseErrors -join '; ')" }

    Invoke-TestCase (New-TestCase 'valid') $true 'exact signed-evidence semantics accept'
    Invoke-TestCase (New-TestCase 'counter' { param($operational) $operational.counters.duplicateMutations = 1 }) $false 'non-zero operational counter rejects'
    Invoke-TestCase (New-TestCase 'missing-check' { param($operational) $operational.checks = @($operational.checks | Select-Object -Skip 1) }) $false 'missing operational check rejects'
    Invoke-TestCase (New-TestCase 'ring-order' { param($operational, $rings) $swap = $rings.rings[0]; $rings.rings[0] = $rings.rings[1]; $rings.rings[1] = $swap }) $false 'reordered rings reject'
    Invoke-TestCase (New-TestCase 'ring-health' { param($operational, $rings) $rings.rings[2].observedHealthHours = 1 }) $false 'insufficient ring health rejects'
    Invoke-TestCase (New-TestCase 'release-binding' { param($operational) $operational.release.msiSha256 = 'f' * 64 }) $false 'mismatched release binding rejects'
    Invoke-TestCase (New-TestCase 'artifact-binding' { param($operational) $operational.checks[0].artifactSha256 = 'e' * 64 }) $false 'unbound immutable artifact rejects'
    Invoke-TestCase (New-TestCase 'provider-binding-digest' { param($operational) $operational.providerContract.attestationArtifactSha256 = 'd' * 64 }) $false 'provider attestation digest substitution rejects'
    Invoke-TestCase (New-TestCase 'provider-check-binding' {
        param($operational)
        $providerCheck = @($operational.checks | Where-Object { $_.id -ceq 'provider-zero-training-and-zero-retention-contract' })[0]
        $providerCheck.artifactSha256 = [string]$operational.providerContract.publicKeyArtifactSha256
    }) $false 'provider check must bind exact attestation bytes'
    Invoke-TestCase (New-TestCase 'provider-origin' { param($operational) $operational.providerContract.apiOrigin = 'https://proxy.invalid' }) $false 'provider API-origin substitution rejects'
    Invoke-TestCase (New-TestCase 'provider-credential-key' { param($operational) $operational.providerContract.apiCredentialKeyId = 'ephemeral-test-credential/key-v2' }) $false 'provider credential-key rotation requires matching signed attestation'
    Invoke-TestCase (New-TestCase 'provider-credential-key-missing' { param($operational) $operational.providerContract.PSObject.Properties.Remove('apiCredentialKeyId') }) $false 'missing provider credential-key binding rejects'
    Invoke-TestCase (New-TestCase 'provider-model-type' { param($operational) $operational.providerContract.permittedModelIds = 'claude-sonnet-4-5' }) $false 'provider model scope must remain a JSON array'
    Invoke-TestCase (New-TestCase 'provider-boolean-type' { param($operational) $operational.providerContract.zeroTraining = 1 }) $false 'provider zero-training claim must remain a JSON boolean'
    $tamperedDocumentFixture = New-TestCase 'provider-document-tamper'
    Add-Content -LiteralPath $tamperedDocumentFixture.ProviderDocument -Value 'tamper' -Encoding ascii
    Invoke-TestCase $tamperedDocumentFixture $false 'actual provider contract document tamper rejects'
    $tamperedKeyFixture = New-TestCase 'provider-key-tamper'
    Set-Content -LiteralPath $tamperedKeyFixture.ProviderPublicKey -Value 'not a public key' -Encoding ascii
    Invoke-TestCase $tamperedKeyFixture $false 'actual provider public-key tamper rejects'
    $extraFileFixture = New-TestCase 'unreviewed-candidate-file'
    Set-Content -LiteralPath (Join-Path $extraFileFixture.Candidate 'unreviewed.bin') -Value 'tamper' -Encoding ascii
    Invoke-TestCase $extraFileFixture $false 'unreviewed candidate file rejects'
}
finally {
    $env:DOTNET_ROOT = $originalDotNetRoot
    $resolvedTemp = [IO.Path]::GetFullPath($testRoot)
    $expectedPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\msaidizi-operational-policy-'
    if ($resolvedTemp.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host 'Operational evidence policy dynamic checks passed: 17 cases.'
Write-Host 'Operational evidence schema consistency checks passed: exactly 15 reviewed checks, a strict provider-contract binding, and at least 18 artifacts.'
Write-Host 'Signatures are stubbed only in this disposable developer harness; production entry trust and external evidence remain unproven.'
