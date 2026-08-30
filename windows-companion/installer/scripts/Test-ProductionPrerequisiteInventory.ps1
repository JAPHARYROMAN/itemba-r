[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$inventoryPath = Join-Path $PSScriptRoot 'Test-ProductionPrerequisites.ps1'
$policyPath = Join-Path $PSScriptRoot '..\release-policy.json'
$pwsh = (Get-Command pwsh.exe -ErrorAction Stop).Source
$expectedInventorySha256 = '1E821086572EBFBFE5276325E9CF22D2C602DE7CD38D467915F34DD1FFEFDB13'
$actualInventorySha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $inventoryPath -Algorithm SHA256).Hash
if ($actualInventorySha256 -cne $expectedInventorySha256) {
    throw 'Production-prerequisite inventory bytes differ from the reviewed dynamic harness binding.'
}
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('msaidizi-prerequisite-inventory-' + [guid]::NewGuid().ToString('N'))
$passed = 0

function Assert-Condition {
    param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
    if (-not $Condition) { throw "Production-prerequisite inventory test failed: $Message" }
    $script:passed++
}

function Invoke-Inventory {
    param([string[]]$Arguments = @())

    $output = @(& $pwsh -NoLogo -NoProfile -NonInteractive -File $inventoryPath @Arguments 2>&1 |
        ForEach-Object { $_.ToString() })
    $exitCode = $LASTEXITCODE
    $nonempty = @($output | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    if ($nonempty.Count -ne 1) {
        throw "Inventory must emit exactly one JSON line; received $($nonempty.Count)."
    }
    $report = $nonempty[0] | Microsoft.PowerShell.Utility\ConvertFrom-Json -ErrorAction Stop
    return [pscustomobject]@{
        ExitCode = $exitCode
        Output = $nonempty[0]
        Report = $report
    }
}

function Get-Check {
    param([Parameter(Mandatory)]$Report, [Parameter(Mandatory)][string]$Id)
    $matches = @($Report.checks | Where-Object { [string]$_.id -ceq $Id })
    if ($matches.Count -ne 1) { throw "Expected exactly one inventory check '$Id'; found $($matches.Count)." }
    return $matches[0]
}

function New-PolicyFixture {
    param([Parameter(Mandatory)][string]$Name, [Parameter(Mandatory)][scriptblock]$Mutate)
    $fixture = Get-Content -LiteralPath $policyPath -Raw -Encoding utf8 | ConvertFrom-Json
    & $Mutate $fixture
    $fixturePath = Join-Path $testRoot "$Name.json"
    $fixture | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $fixturePath -Encoding utf8
    return $fixturePath
}

try {
    New-Item -ItemType Directory -Path $testRoot -ErrorAction Stop | Out-Null

    $parseErrors = $null
    [void][Management.Automation.Language.Parser]::ParseFile($inventoryPath, [ref]$null, [ref]$parseErrors)
    Assert-Condition (@($parseErrors).Count -eq 0) 'inventory PowerShell parses'

    $source = Get-Content -LiteralPath $inventoryPath -Raw -Encoding utf8
    Assert-Condition (-not $source.Contains('$_.Exception.Message') -and -not $source.Contains('Write-Host')) 'inventory source has no exception-message or host-output leak path'
    Assert-Condition ($source.Contains("productionDeploymentEligible = `$false") -and
        $source.Contains("authority = 'NON_AUTHORITATIVE_READ_ONLY_INVENTORY'")) 'inventory cannot assert production eligibility'

    $default = Invoke-Inventory
    Assert-Condition ($default.ExitCode -eq 2) 'incomplete default inventory exits with the stable blocking code'
    Assert-Condition ([string]$default.Report.state -ceq 'NOT_READY' -and
        -not [bool]$default.Report.inputSetComplete -and
        -not [bool]$default.Report.productionDeploymentEligible) 'incomplete default inventory is explicitly non-authoritative and not ready'
    Assert-Condition ([int]$default.Report.blockingCheckCount -gt 0 -and
        [int]$default.Report.totalCheckCount -eq @($default.Report.checks).Count) 'summary counts match emitted checks'
    Assert-Condition (@($default.Report.checks | Group-Object id | Where-Object Count -ne 1).Count -eq 0) 'every emitted check ID is unique'
    Assert-Condition ((Get-Check -Report $default.Report -Id 'release_policy_provisioned').reasonCode -ceq 'release_policy_unprovisioned') 'exact repository placeholder policy is classified UNPROVISIONED'
    $egressCode = Get-Check -Report $default.Report -Id 'egress_boundary_client_implemented'
    Assert-Condition ($egressCode.status -ceq 'BLOCKED' -and $egressCode.reasonCode -ceq 'egress_source_components_present_not_deployment_proof' -and [bool]$egressCode.evidence.sourceComponentsPresent -and -not [bool]$egressCode.evidence.productionProof) 'egress source components remain explicitly blocked and non-deployment proof'
    Assert-Condition ((Get-Check -Report $default.Report -Id 'egress_boundary_deployment_evidence').status -ceq 'BLOCKED') 'egress cannot become ready from source or service presence without signed live enforcement evidence'
    $isolationCode = Get-Check -Report $default.Report -Id 'trusted_root_isolation_gate_implemented'
    Assert-Condition ($isolationCode.status -ceq 'BLOCKED' -and $isolationCode.reasonCode -ceq 'isolation_client_and_fail_closed_fallback_present_not_deployment_proof' -and [bool]$isolationCode.evidence.sourceComponentsPresent -and [bool]$isolationCode.evidence.rejectingFallbackRetained) 'isolation source inventory requires the safe rejecting fallback and remains blocked as non-deployment proof'
    Assert-Condition ((Get-Check -Report $default.Report -Id 'trusted_root_isolation_evidence').status -ceq 'BLOCKED') 'isolation cannot become ready from source or service presence without signed live native enforcement evidence'
    Assert-Condition ($source.Contains('SignedCms') -and
        $source.Contains('detached_cms_exact_policy_signer_and_live_claims') -and
        $source.Contains('kernelOrWfpEnforcementActive') -and
        $source.Contains('supervisorOwnedDataPathConsumed') -and
        $source.Contains('attestationSpkiSha256') -and
        $source.Contains('receiptSpkiSha256') -and
        $source.Contains('destinationPolicySha256') -and
        $source.Contains('credentialRecordSha256Bound') -and
        $source.Contains('credentialVaultSupervisorReadOnly') -and
        $source.Contains('trustedRootKillSwitchEnforced') -and
        $source.Contains('exactRequestPolicyEnforced') -and
        $source.Contains('supervisorOwnedTlsAndSocket') -and
        $source.Contains('restrictedServicePeerVerifiedBeforeTokenWrite') -and
        $source.Contains('processCreationIdentityBoundAcrossFlow') -and
        $source.Contains('executeOnlyAuthorizationVerified') -and
        $source.Contains('exactBrokerResidualVerified') -and
        $source.Contains('mappedSupervisorSelfImageVerified') -and
        $source.Contains('executeOnlyAuthorizationNegativeControlResultSha256') -and
        $source.Contains('brokerResidualNegativeControlsResultSha256') -and
        $source.Contains('mappedSupervisorSelfImageNegativeControlResultSha256') -and
        $source.Contains('nativeEnforcementActive') -and
        $source.Contains('supervisorProcessDenyActive') -and
        $source.Contains('reservationLeaseKeyId') -and
        $source.Contains('terminalEnforcementReceiptSpkiSha256') -and
        $source.Contains('actionTokenVerificationKeyId') -and
        $source.Contains('driverAttestationVerificationKeyId') -and
        $source.Contains('supervisorServiceImageSha256') -and
        $source.Contains('companionServiceImageSha256') -and
        $source.Contains('driverImageSha256') -and
        $source.Contains('isolationPolicySha256') -and
        $source.Contains('driverPolicyEpoch') -and
        $source.Contains('actionTokenIndependentlyVerified') -and
        $source.Contains('actionTokenClaimsBoundToRequest') -and
        $source.Contains('verificationCertificatesPublicOnly') -and
        $source.Contains('verificationKeysPurposeDistinct') -and
        $source.Contains('signedDriverAttestationVerified') -and
        $source.Contains('driverAttestationNonceBound') -and
        $source.Contains('driverAttestationFresh') -and
        $source.Contains('driverAttestationSigningKeyHardwareBacked') -and
        $source.Contains('secureBootVerified') -and
        $source.Contains('hvciVerified') -and
        $source.Contains('wdacVerified') -and
        $source.Contains('exactInvocationBoundToSignedArguments') -and
        $source.Contains('suspendedProcessImageIdentityBound') -and
        $source.Contains('liveDriverServiceAndLoadedImageVerified') -and
        $source.Contains('driverDeviceHandleBoundToSignedAttestation') -and
        $source.Contains('protocolVersion') -and
        $source.Contains('supervisorServiceSid') -and
        $source.Contains('actionTokenExpectedIssuer') -and
        $source.Contains('actionTokenExpectedAudience') -and
        $source.Contains('actionTokenExpectedSubject') -and
        $source.Contains('maximumInvocationTimeoutSeconds') -and
        $source.Contains('maximumInvocationOutputBytes') -and
        $source.Contains('maximumInvocationProcesses') -and
        $source.Contains('maximumInvocationProcessMemoryBytes') -and
        $source.Contains('driverAttestationBootBound') -and
        $source.Contains('exactSuspendedInvocationMeasurementBound') -and
        $source.Contains('mappedProcessImageIdentityBound') -and
        $source.Contains('isolationJournalSha256') -and
        $source.Contains('authorizationPersistenceVerificationResultSha256') -and
        $source.Contains('authorizationMaterialDigestOnlyPersistenceVerified') -and
        $source.Contains('$claim.vmEvidence.runId') -and
        $source.Contains('vmRunBoundToSignedInstallerAcceptance') -and
        $source.Contains('signed_installer_vm_approval_verified') -and
        $source.Contains('deployment_evidence_vm_run_not_bound_to_signed_installer_acceptance') -and
        $source.Contains('companionPurposePinsMatched') -and
        $source.Contains('serviceOnlyCngKeyDaclsExact') -and
        $source.Contains('$claim.kernelOrWfpEnforcementActive -is [bool]') -and
        $source.Contains('$claim.credentialRecordSha256Bound -is [bool]') -and
        $source.Contains('$claim.supervisorOwnedTlsAndSocket -is [bool]') -and
        $source.Contains('$claim.executeOnlyAuthorizationVerified -is [bool]') -and
        $source.Contains('$claim.exactBrokerResidualVerified -is [bool]') -and
        $source.Contains('$claim.mappedSupervisorSelfImageVerified -is [bool]') -and
        $source.Contains('$claim.executeOnlyAuthorizationNegativeControlResultSha256 -is [string]') -and
        $source.Contains('$claim.brokerResidualNegativeControlsResultSha256 -is [string]') -and
        $source.Contains('$claim.mappedSupervisorSelfImageNegativeControlResultSha256 -is [string]') -and
        $source.Contains('$claim.nativeEnforcementActive -is [bool]') -and
        $source.Contains('$claim.actionTokenIndependentlyVerified -is [bool]') -and
        $source.Contains('$claim.signedDriverAttestationVerified -is [bool]') -and
        $source.Contains('$claim.driverAttestationSigningKeyHardwareBacked -is [bool]') -and
        $source.Contains('$claim.driverAttestationBootBound -is [bool]') -and
        $source.Contains('$claim.exactSuspendedInvocationMeasurementBound -is [bool]') -and
        $source.Contains('$claim.mappedProcessImageIdentityBound -is [bool]') -and
        $source.Contains('$claim.authorizationMaterialDigestOnlyPersistenceVerified -is [bool]') -and
        $source.Contains('$claim.driverDeviceHandleBoundToSignedAttestation -is [bool]') -and
        $source.Contains('$claim.serviceOnlyCngKeyDaclsExact -is [bool]')) 'deployment gates require exact detached-CMS, typed live enforcement, and distinct hardware signing-key claims'

    $requiredIds = @(
        'release_policy_readable', 'host_windows_11_x64', 'host_programdata_ntfs',
        'host_tpm_2_ready', 'host_secure_boot_enabled', 'host_hvci_running',
        'release_policy_provisioned', 'release_entry_policy_bindings',
        'release_pipeline_authenticode', 'tool_dotnet_pinned',
        'tool_signtool_microsoft_signed', 'tool_sbom_pinned', 'tool_defender_ready',
        'release_signing_certificate_available', 'release_signing_key_attestation',
        'release_timestamp_https_configured', 'wix_legal_attestation_present',
        'source_clean_committed', 'vm_orchestrator_trusted', 'vm_hypervisor_available',
        'vm_clean_template_evidence', 'provider_contract_verifier_available',
        'provider_contract_attestation_available', 'provider_contract_public_key_available',
        'provider_contract_document_available', 'egress_boundary_client_implemented',
        'trusted_root_isolation_gate_implemented', 'egress_boundary_deployment_evidence',
        'trusted_root_isolation_evidence', 'device_enrollment_evidence',
        'installer_vm_approval_claim', 'installer_vm_approval_signature',
        'operational_evidence_claim', 'operational_evidence_signature',
        'ring_evidence_claim', 'ring_evidence_signature',
        'production_acceptance_claim', 'production_acceptance_signature'
    )
    $actualIds = @($default.Report.checks | ForEach-Object { [string]$_.id } | Sort-Object)
    Assert-Condition (($actualIds -join '|') -ceq (@($requiredIds | Sort-Object) -join '|')) 'All scope emits the exact reviewed check set'

    $partialPolicyPath = New-PolicyFixture -Name 'partial-policy' -Mutate {
        param($policy)
        $policy.dotnetHostSha256 = 'A' * 64
    }
    $partial = Invoke-Inventory -Arguments @('-Scope', 'BuildHost', '-ReleasePolicyPath', $partialPolicyPath)
    Assert-Condition ((Get-Check -Report $partial.Report -Id 'release_policy_provisioned').reasonCode -ceq 'release_policy_invalid_or_partial') 'partial policy provisioning is classified INVALID'

    $provisionedPolicyPath = New-PolicyFixture -Name 'provisioned-policy' -Mutate {
        param($policy)
        $policy.dotnetHostSha256 = 'A' * 64
        $policy.sbomToolSha256 = 'B' * 64
        $policy.trust.pipelineSignerThumbprint = '1' * 40
        $policy.trust.releaseSignerThumbprint = '2' * 40
        $policy.trust.allowedVmEvidenceSignerThumbprints = @(('3' * 40))
        $policy.trust.allowedVmOrchestratorSignerThumbprints = @(('4' * 40))
        $policy.trust.allowedOperationalEvidenceSignerThumbprints = @(('5' * 40))
        $policy.trust.allowedRingEvidenceSignerThumbprints = @(('6' * 40))
    }
    $provisioned = Invoke-Inventory -Arguments @('-Scope', 'BuildHost', '-ReleasePolicyPath', $provisionedPolicyPath)
    $provisionedCheck = Get-Check -Report $provisioned.Report -Id 'release_policy_provisioned'
    Assert-Condition ($provisionedCheck.status -ceq 'PASS' -and $provisionedCheck.reasonCode -ceq 'release_policy_provisioned') 'complete distinct policy provisioning is accepted without bypassing later blockers'
    Assert-Condition ($provisioned.ExitCode -eq 2 -and -not [bool]$provisioned.Report.productionDeploymentEligible) 'provisioned policy alone never makes the inventory authoritative or ready'

    $operationalOnly = Invoke-Inventory -Arguments @('-Scope', 'Operational')
    Assert-Condition (@($operationalOnly.Report.checks | Where-Object { [string]$_.id -ceq 'host_windows_11_x64' }).Count -eq 0 -and
        @($operationalOnly.Report.checks | Where-Object { [string]$_.id -ceq 'egress_boundary_client_implemented' }).Count -eq 1) 'scope selection omits unrelated host probes and retains operational blockers'

    $sentinelName = 'SENTINEL_PATH_AND_SECRET_MUST_NOT_LEAK'
    $sentinelPath = Join-Path $testRoot "$sentinelName.bin"
    Set-Content -LiteralPath $sentinelPath -Value 'SENTINEL_CONTENT_MUST_NOT_LEAK' -Encoding utf8
    $artifactArguments = @(
        '-Scope', 'All', '-DotNetPath', $sentinelPath, '-SignToolPath', $sentinelPath,
        '-SbomToolPath', $sentinelPath, '-DefenderCommandPath', $sentinelPath,
        '-SigningKeyAttestationPath', $sentinelPath, '-VmOrchestratorPath', $sentinelPath,
        '-VmOrchestratorSignerThumbprint', ('4' * 40), '-VmTemplateEvidencePath', $sentinelPath,
        '-ProviderContractVerifierPath', $sentinelPath, '-ProviderContractAttestationPath', $sentinelPath,
        '-ProviderContractPublicKeyPath', $sentinelPath, '-ProviderContractDocumentPath', $sentinelPath,
        '-EgressBoundaryDeploymentEvidencePath', $sentinelPath,
        '-EgressBoundaryDeploymentEvidenceSignaturePath', $sentinelPath,
        '-EgressBoundaryDeploymentEvidenceSignerThumbprint', ('5' * 40),
        '-TrustedRootIsolationEvidencePath', $sentinelPath,
        '-TrustedRootIsolationEvidenceSignaturePath', $sentinelPath,
        '-TrustedRootIsolationEvidenceSignerThumbprint', ('5' * 40),
        '-DeviceEnrollmentEvidencePath', $sentinelPath, '-InstallerVmApprovalPath', $sentinelPath,
        '-InstallerVmApprovalSignaturePath', $sentinelPath, '-OperationalEvidencePath', $sentinelPath,
        '-OperationalEvidenceSignaturePath', $sentinelPath, '-RingEvidencePath', $sentinelPath,
        '-RingEvidenceSignaturePath', $sentinelPath, '-ProductionAcceptancePath', $sentinelPath,
        '-ProductionAcceptanceSignaturePath', $sentinelPath
    )
    $redaction = Invoke-Inventory -Arguments $artifactArguments
    Assert-Condition (-not $redaction.Output.Contains($sentinelName) -and
        -not $redaction.Output.Contains('SENTINEL_CONTENT_MUST_NOT_LEAK') -and
        -not $redaction.Output.Contains($testRoot)) 'JSON/stdout redacts caller paths and sentinel content'
    Assert-Condition (@($redaction.Report.checks | Where-Object {
        @($_.evidence.PSObject.Properties | ForEach-Object { $_.Name }) -contains 'validationLevel' -and
        [string]$_.evidence.validationLevel -ceq 'presence_and_digest_only'
    }).Count -gt 0) 'available external files are labelled presence-and-digest only'

    $unsafePaths = @(
        [pscustomobject]@{ Path = 'relative-SENTINEL-artifact.bin'; Reason = 'artifact_path_not_canonical_local' },
        [pscustomobject]@{ Path = '\\server\share\UNC_SENTINEL.bin'; Reason = 'artifact_path_not_canonical_local' },
        [pscustomobject]@{ Path = '\\?\C:\DEVICE_SENTINEL.bin'; Reason = 'artifact_path_not_canonical_local' },
        [pscustomobject]@{ Path = "${sentinelPath}:ADS_SENTINEL"; Reason = 'artifact_path_contains_alternate_data_stream' }
    )
    foreach ($unsafe in $unsafePaths) {
        $unsafeResult = Invoke-Inventory -Arguments @(
            '-Scope', 'BuildHost', '-SigningKeyAttestationPath', [string]$unsafe.Path)
        $unsafeCheck = Get-Check -Report $unsafeResult.Report -Id 'release_signing_key_attestation'
        Assert-Condition ($unsafeCheck.reasonCode -ceq [string]$unsafe.Reason -and
            -not $unsafeResult.Output.Contains('SENTINEL')) 'relative, UNC, device, and ADS artifacts fail before access without leaking paths'
    }

    $unsafePolicy = Invoke-Inventory -Arguments @(
        '-Scope', 'Operational', '-ReleasePolicyPath', '\\server\share\POLICY_SENTINEL.json')
    $unsafePolicyCheck = Get-Check -Report $unsafePolicy.Report -Id 'release_policy_readable'
    Assert-Condition ($unsafePolicyCheck.reasonCode -ceq 'release_policy_unreadable' -and
        -not $unsafePolicy.Output.Contains('POLICY_SENTINEL') -and
        -not $unsafePolicy.Output.Contains('server')) 'release policy refuses UNC input before network access and redacts it'

    $oversizedPath = Join-Path $testRoot 'OVERSIZED_SENTINEL.bin'
    $oversizedStream = [IO.File]::Open(
        $oversizedPath,
        [IO.FileMode]::CreateNew,
        [IO.FileAccess]::Write,
        [IO.FileShare]::None)
    try { $oversizedStream.SetLength(67108865) } finally { $oversizedStream.Dispose() }
    $oversized = Invoke-Inventory -Arguments @(
        '-Scope', 'BuildHost', '-SigningKeyAttestationPath', $oversizedPath)
    Assert-Condition ((Get-Check -Report $oversized.Report -Id 'release_signing_key_attestation').reasonCode -ceq 'artifact_too_large' -and
        -not $oversized.Output.Contains('OVERSIZED_SENTINEL')) 'oversized artifacts block before hashing and do not leak paths'
}
finally {
    $resolvedTemp = [IO.Path]::GetFullPath($testRoot)
    $expectedPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\msaidizi-prerequisite-inventory-'
    if ($resolvedTemp.StartsWith($expectedPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "Production-prerequisite inventory checks passed: $passed assertions."
Write-Host 'The harness validates diagnostic behavior only; it does not provision trust, execute a VM, or produce operational/ring acceptance evidence.'
