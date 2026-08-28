[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$installerRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$companionRoot = [IO.Path]::GetFullPath((Join-Path $installerRoot '..'))
$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $companionRoot '..'))
$failures = [Collections.Generic.List[string]]::new()
$passes = [Collections.Generic.List[string]]::new()

function Assert-Static {
    param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Message)
    if ($Condition) { $script:passes.Add($Message) } else { $script:failures.Add($Message) }
}

function Get-JsonFile {
    param([Parameter(Mandatory)][string]$RelativePath)
    $path = Join-Path $installerRoot $RelativePath
    try { return Get-Content -LiteralPath $path -Raw -Encoding utf8 | ConvertFrom-Json }
    catch { $script:failures.Add("JSON parse failed: $RelativePath - $($_.Exception.Message)"); return $null }
}

function Copy-PolicyFixture {
    param([Parameter(Mandatory)]$Policy)
    return $Policy | ConvertTo-Json -Depth 20 | ConvertFrom-Json
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
        if ($isUnprovisioned) {
            return 'UNPROVISIONED'
        }

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
                if ($signerText -cnotmatch '^[0-9A-Fa-f]{40}$') {
                    return 'INVALID'
                }
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

function Set-UnprovisionedPolicyFixture {
    param([Parameter(Mandatory)]$Policy)
    $Policy.dotnetHostSha256 = 'PROVISIONING_REQUIRED'
    $Policy.sbomToolSha256 = 'PROVISIONING_REQUIRED'
    $Policy.trust.pipelineSignerThumbprint = 'PROVISIONING_REQUIRED'
    $Policy.trust.releaseSignerThumbprint = 'PROVISIONING_REQUIRED'
    $Policy.trust.allowedVmEvidenceSignerThumbprints = @()
    $Policy.trust.allowedVmOrchestratorSignerThumbprints = @()
    $Policy.trust.allowedOperationalEvidenceSignerThumbprints = @()
    $Policy.trust.allowedRingEvidenceSignerThumbprints = @()
    return $Policy
}

function Set-ProvisionedPolicyFixture {
    param([Parameter(Mandatory)]$Policy)
    $Policy.dotnetHostSha256 = 'A' * 64
    $Policy.sbomToolSha256 = 'B' * 64
    $Policy.trust.pipelineSignerThumbprint = '1' * 40
    $Policy.trust.releaseSignerThumbprint = '2' * 40
    $Policy.trust.allowedVmEvidenceSignerThumbprints = @(('3' * 40))
    $Policy.trust.allowedVmOrchestratorSignerThumbprints = @(('4' * 40))
    $Policy.trust.allowedOperationalEvidenceSignerThumbprints = @(('5' * 40))
    $Policy.trust.allowedRingEvidenceSignerThumbprints = @(('6' * 40))
    return $Policy
}

$scriptFiles = @(Get-ChildItem -LiteralPath (Join-Path $installerRoot 'scripts'), (Join-Path $installerRoot 'vm') -Recurse -File |
    Where-Object { $_.Extension -in '.ps1', '.psm1', '.psd1' })
foreach ($scriptFile in $scriptFiles) {
    $parseErrors = $null
    [Management.Automation.Language.Parser]::ParseFile($scriptFile.FullName, [ref]$null, [ref]$parseErrors) | Out-Null
    Assert-Static (@($parseErrors).Count -eq 0) "PowerShell syntax: $($scriptFile.Name)"
}

$policy = Get-JsonFile 'release-policy.json'
Assert-Static ($null -ne $policy) 'Release policy parses'
if ($policy) {
    Assert-Static ($policy.dotnetSdkVersion -eq '8.0.400') 'Pinned .NET SDK is 8.0.400'
    Assert-Static ($policy.runtimeIdentifier -eq 'win-x64') 'Pinned runtime is win-x64'
    Assert-Static ($policy.wixToolsetVersion -eq '7.0.0') 'Pinned WiX SDK is 7.0.0'
    Assert-Static ($policy.sbomToolVersion -eq '4.1.5') 'Pinned SBOM Tool is 4.1.5'
    $policyProvisioningState = Get-ReleasePolicyProvisioningState -Policy $policy
    Assert-Static ($policyProvisioningState -in @('UNPROVISIONED', 'PROVISIONED')) 'Release trust policy is exactly unprovisioned or completely provisioned'

    $unprovisionedFixture = Set-UnprovisionedPolicyFixture -Policy (Copy-PolicyFixture -Policy $policy)
    Assert-Static ((Get-ReleasePolicyProvisioningState -Policy $unprovisionedFixture) -ceq 'UNPROVISIONED') 'Exact fail-closed provisioning defaults are accepted'

    $provisionedFixture = Set-ProvisionedPolicyFixture -Policy (Copy-PolicyFixture -Policy $policy)
    Assert-Static ((Get-ReleasePolicyProvisioningState -Policy $provisionedFixture) -ceq 'PROVISIONED') 'Complete distinct production trust provisioning is accepted'

    $partialToolFixture = Set-UnprovisionedPolicyFixture -Policy (Copy-PolicyFixture -Policy $policy)
    $partialToolFixture.dotnetHostSha256 = 'A' * 64
    Assert-Static ((Get-ReleasePolicyProvisioningState -Policy $partialToolFixture) -ceq 'INVALID') 'Partial tool-hash provisioning is rejected'

    $partialSignerFixture = Set-UnprovisionedPolicyFixture -Policy (Copy-PolicyFixture -Policy $policy)
    $partialSignerFixture.trust.pipelineSignerThumbprint = '1' * 40
    Assert-Static ((Get-ReleasePolicyProvisioningState -Policy $partialSignerFixture) -ceq 'INVALID') 'Partial signer provisioning is rejected'

    $mixedAllowlistFixture = Set-UnprovisionedPolicyFixture -Policy (Copy-PolicyFixture -Policy $policy)
    $mixedAllowlistFixture.trust.allowedVmEvidenceSignerThumbprints = @(('3' * 40))
    Assert-Static ((Get-ReleasePolicyProvisioningState -Policy $mixedAllowlistFixture) -ceq 'INVALID') 'Mixed placeholder and evidence-allowlist provisioning is rejected'

    $missingRoleFixture = Set-ProvisionedPolicyFixture -Policy (Copy-PolicyFixture -Policy $policy)
    $missingRoleFixture.trust.allowedRingEvidenceSignerThumbprints = @()
    Assert-Static ((Get-ReleasePolicyProvisioningState -Policy $missingRoleFixture) -ceq 'INVALID') 'Provisioning with a missing signer role is rejected'

    $malformedHashFixture = Set-ProvisionedPolicyFixture -Policy (Copy-PolicyFixture -Policy $policy)
    $malformedHashFixture.sbomToolSha256 = 'B' * 63
    Assert-Static ((Get-ReleasePolicyProvisioningState -Policy $malformedHashFixture) -ceq 'INVALID') 'Provisioning with a malformed tool hash is rejected'

    $reusedSignerFixture = Set-ProvisionedPolicyFixture -Policy (Copy-PolicyFixture -Policy $policy)
    $reusedSignerFixture.trust.allowedRingEvidenceSignerThumbprints = @($reusedSignerFixture.trust.allowedOperationalEvidenceSignerThumbprints[0])
    Assert-Static ((Get-ReleasePolicyProvisioningState -Policy $reusedSignerFixture) -ceq 'INVALID') 'Provisioning that reuses a signer across trust roles is rejected'
    Assert-Static ($policy.maximumOperationalEvidenceAgeHours -gt 0 -and $policy.maximumRingEvidenceAgeHours -gt 0) 'Operational and ring evidence freshness limits are protected policy'
    Assert-Static ($policy.minimumRingHealthHours.RING_0 -gt 0 -and $policy.minimumRingHealthHours.RING_5 -gt 0 -and $policy.minimumRingHealthHours.RING_25 -gt 0 -and $policy.minimumRingHealthHours.RING_100 -gt 0) 'Every rollout ring has a protected minimum health window'
}

$wixProjectPath = Join-Path $installerRoot 'wix\Itemba.Msaidizi.Companion.Installer.wixproj'
$wixProjectText = Get-Content -LiteralPath $wixProjectPath -Raw -Encoding utf8
[xml]$wixProject = $wixProjectText
Assert-Static ($wixProject.Project.Sdk -eq 'WixToolset.Sdk/7.0.0') 'WiX SDK package is exact'
Assert-Static ($wixProject.Project.PropertyGroup.Platform -eq 'x64') 'WiX target platform is x64'
Assert-Static ($wixProject.Project.PropertyGroup.OutputType -eq 'Package') 'WiX output is MSI package'
Assert-Static ($wixProject.Project.PropertyGroup.RestoreLockedMode -eq 'true') 'WiX restore is locked'
Assert-Static ($wixProject.Project.PropertyGroup.TreatWarningsAsErrors -eq 'true' -and $wixProject.Project.PropertyGroup.Pedantic -eq 'true' -and $wixProject.Project.PropertyGroup.SuppressAllWarnings -eq 'false') 'WiX compiler/pedantic warnings are fatal and unsuppressed'
Assert-Static ($wixProject.Project.PropertyGroup.SuppressValidation -eq 'false' -and [string]::IsNullOrEmpty([string]$wixProject.Project.PropertyGroup.SuppressIces)) 'Stock MSI schema/ICE validation is enabled with no suppressed ICEs'
Assert-Static ($wixProjectText -match 'AfterTargets="WindowsInstallerValidation"' -and $wixProjectText -match 'schema-and-stock-ice-validation=PASS') 'Post-ICE success marker is bound to the WiX validation target'
Assert-Static ($wixProjectText -match 'MSI schema/ICE validation may not be suppressed' -and $wixProjectText -match 'Suppressing any stock MSI ICE is forbidden') 'MSBuild rejects validation or ICE suppression overrides'
Assert-Static ($wixProjectText -notmatch '<AcceptEula>') 'WiX legal acceptance is not embedded or inferred in project authoring'

$packagePath = Join-Path $installerRoot 'wix\Package.wxs'
[xml]$package = Get-Content -LiteralPath $packagePath -Raw -Encoding utf8
$namespace = [Xml.XmlNamespaceManager]::new($package.NameTable)
$namespace.AddNamespace('w', 'http://wixtoolset.org/schemas/v4/wxs')
Assert-Static ($package.DocumentElement.NamespaceURI -eq 'http://wixtoolset.org/schemas/v4/wxs') 'Current WiX v4+ XML namespace is used'
Assert-Static ($package.DocumentElement.RequiredVersion -eq '7.0.0') 'WiX authoring requires 7.0.0'
$packageNode = $package.SelectSingleNode('/w:Wix/w:Package', $namespace)
Assert-Static ($packageNode.Scope -eq 'perMachine') 'MSI is per-machine'
Assert-Static ($packageNode.InstallerVersion -eq '500') 'MSI requires current Windows Installer engine'
$releasePolicy = Get-JsonFile 'release-policy.json'
if ($releasePolicy) {
    $expectedPolicyServices = [ordered]@{
        companion = 'Itemba Msaidizi Companion'
        updateSupervisor = 'Itemba Msaidizi Update Supervisor'
        recoverySupervisor = 'Itemba Msaidizi Recovery Supervisor'
        auditSigner = 'Itemba Msaidizi Audit Signer'
        egressSupervisor = 'Itemba Msaidizi Egress Supervisor'
        privilegedCommandSupervisor = 'Itemba Msaidizi Privileged Command Supervisor'
    }
    $actualPolicyServiceNames = @($releasePolicy.services.PSObject.Properties.Name | Sort-Object)
    Assert-Static (($actualPolicyServiceNames -join '|') -ceq (@($expectedPolicyServices.Keys | Sort-Object) -join '|')) 'Release policy inventories exactly six Windows services'
    foreach ($serviceProperty in $expectedPolicyServices.Keys) {
        Assert-Static ([string]$releasePolicy.services.$serviceProperty -ceq $expectedPolicyServices[$serviceProperty]) "Release policy pins exact service name: $serviceProperty"
    }
}

$serviceNodes = @($package.SelectNodes('//w:ServiceInstall', $namespace))
Assert-Static ($serviceNodes.Count -eq 6) 'Exactly six Windows services are authored'
$expectedServices = @{
    'Itemba Msaidizi Companion' = 'auto'
    'Itemba Msaidizi Update Supervisor' = 'demand'
    'Itemba Msaidizi Recovery Supervisor' = 'demand'
    'Itemba Msaidizi Audit Signer' = 'demand'
    'Itemba Msaidizi Egress Supervisor' = 'auto'
    'Itemba Msaidizi Privileged Command Supervisor' = 'auto'
}
foreach ($serviceName in $expectedServices.Keys) {
    $serviceNode = $serviceNodes | Where-Object { $_.Name -eq $serviceName }
    Assert-Static ($null -ne $serviceNode) "Service exists: $serviceName"
    if ($serviceNode) {
        Assert-Static ($serviceNode.Start -eq $expectedServices[$serviceName]) "Reviewed start mode: $serviceName"
        Assert-Static ($serviceNode.Account -eq 'LocalSystem' -and $serviceNode.Type -eq 'ownProcess') "Exact service account/type: $serviceName"
        Assert-Static ($serviceNode.Arguments -match '^--contentRoot .+ConfigDir') "Explicit ProgramData contentRoot: $serviceName"
        Assert-Static ($serviceNode.ServiceConfig.ServiceSid -eq 'restricted') "Restricted service SID: $serviceName"
    }
}
$mainService = $serviceNodes | Where-Object { $_.Name -eq 'Itemba Msaidizi Companion' }
Assert-Static ($mainService.ServiceConfig.DelayedAutoStart -eq 'yes') 'Main service is delayed automatic'
$mainDependencies = @($mainService.ServiceDependency | ForEach-Object { $_.Id } | Sort-Object)
$expectedMainDependencies = @(
    'Itemba Msaidizi Egress Supervisor',
    'Itemba Msaidizi Privileged Command Supervisor'
) | Sort-Object
Assert-Static (($mainDependencies -join '|') -ceq ($expectedMainDependencies -join '|')) 'Main service depends on both independent enforcement supervisors exactly'
foreach ($enforcementServiceName in @('Itemba Msaidizi Egress Supervisor', 'Itemba Msaidizi Privileged Command Supervisor')) {
    $enforcementService = $serviceNodes | Where-Object { $_.Name -eq $enforcementServiceName }
    Assert-Static ($enforcementService.ServiceConfig.DelayedAutoStart -eq 'no') "Enforcement supervisor is non-delayed automatic: $enforcementServiceName"
    $enforcementPrivileges = @($enforcementService.ServiceConfig.RequiredPrivilege | ForEach-Object { $_.Name } | Sort-Object)
    $reviewedEnforcementPrivileges = @('SeChangeNotifyPrivilege', 'SeImpersonatePrivilege') | Sort-Object
    Assert-Static (($enforcementPrivileges -join '|') -ceq ($reviewedEnforcementPrivileges -join '|')) "Enforcement supervisor has only reviewed required privileges: $enforcementServiceName"
}
$serviceControls = @($package.SelectNodes('//w:ServiceControl', $namespace))
Assert-Static (@($serviceControls | Where-Object { $_.HasAttribute('Start') }).Count -eq 0) 'MSI never starts a service during install'

$mainPrivileges = @($mainService.ServiceConfig.RequiredPrivilege | ForEach-Object { $_.Name } | Sort-Object)
$reviewedMainPrivileges = @('SeAssignPrimaryTokenPrivilege', 'SeChangeNotifyPrivilege', 'SeImpersonatePrivilege', 'SeIncreaseQuotaPrivilege', 'SeShutdownPrivilege', 'SeSystemtimePrivilege') | Sort-Object
Assert-Static (($mainPrivileges -join '|') -eq ($reviewedMainPrivileges -join '|')) 'Main service has only reviewed required privileges'
$forbiddenMainPrivileges = @('SeBackupPrivilege', 'SeRestorePrivilege', 'SeTakeOwnershipPrivilege', 'SeSecurityPrivilege', 'SeDebugPrivilege', 'SeLoadDriverPrivilege')
Assert-Static (@($mainPrivileges | Where-Object { $_ -in $forbiddenMainPrivileges }).Count -eq 0) 'Ordinary companion cannot bypass trusted-root ACLs through privileged token rights'
$updateService = $serviceNodes | Where-Object { $_.Name -eq 'Itemba Msaidizi Update Supervisor' }
Assert-Static (@($updateService.ServiceConfig.RequiredPrivilege | ForEach-Object { $_.Name }).Count -eq 1 -and $updateService.ServiceConfig.RequiredPrivilege.Name -eq 'SeChangeNotifyPrivilege') 'Update supervisor has minimal required privileges'
$recoveryService = $serviceNodes | Where-Object { $_.Name -eq 'Itemba Msaidizi Recovery Supervisor' }
$recoveryPrivileges = @($recoveryService.ServiceConfig.RequiredPrivilege | ForEach-Object { $_.Name } | Sort-Object)
$reviewedRecoveryPrivileges = @('SeBackupPrivilege', 'SeChangeNotifyPrivilege', 'SeRestorePrivilege', 'SeSecurityPrivilege', 'SeShutdownPrivilege', 'SeTakeOwnershipPrivilege') | Sort-Object
Assert-Static (($recoveryPrivileges -join '|') -ceq ($reviewedRecoveryPrivileges -join '|')) 'Recovery supervisor has only reviewed recovery privileges'
$auditSignerService = $serviceNodes | Where-Object { $_.Name -eq 'Itemba Msaidizi Audit Signer' }
Assert-Static (@($auditSignerService.ServiceConfig.RequiredPrivilege | ForEach-Object { $_.Name }).Count -eq 1 -and $auditSignerService.ServiceConfig.RequiredPrivilege.Name -eq 'SeChangeNotifyPrivilege') 'Audit signer has minimal required privileges'

$configComponents = @($package.SelectNodes('//w:Component[contains(@Id,"SafeConfigComponent")]', $namespace))
Assert-Static ($configComponents.Count -eq 7) 'Seven isolated safe configuration components are authored'
foreach ($component in $configComponents) {
    Assert-Static ($component.Permanent -eq 'yes' -and $component.NeverOverwrite -eq 'yes') "Preserved/never-overwritten config: $($component.Id)"
}
$runValue = $package.SelectSingleNode('//w:RegistryValue[@Id="AgentPerUserStartupValue"]', $namespace)
Assert-Static ($runValue.Root -eq 'HKLM' -and $runValue.Key -eq 'SOFTWARE\Microsoft\Windows\CurrentVersion\Run') 'Agent starts per interactive user through HKLM Run'
Assert-Static ($runValue.Value -match '--contentRoot') 'Agent receives explicit ProgramData contentRoot'

$applyHardening = $package.SelectSingleNode('//w:CustomAction[@Id="ApplyInstallerHardening"]', $namespace)
$removeFirewall = $package.SelectSingleNode('//w:CustomAction[@Id="RemoveInstallerFirewallRules"]', $namespace)
Assert-Static ($applyHardening.Execute -eq 'deferred' -and $applyHardening.Impersonate -eq 'no' -and $applyHardening.ExeCommand -match '^install ') 'Hardening runs deferred as LocalSystem'
Assert-Static ($removeFirewall.Execute -eq 'deferred' -and $removeFirewall.ExeCommand -match '^remove-firewall ') 'Uninstall helper is firewall-only'
$applySequence = $package.SelectSingleNode('//w:InstallExecuteSequence/w:Custom[@Action="ApplyInstallerHardening"]', $namespace)
$removeSequence = $package.SelectSingleNode('//w:InstallExecuteSequence/w:Custom[@Action="RemoveInstallerFirewallRules"]', $namespace)
Assert-Static ($applySequence.After -eq 'InstallServices') 'ACL/service/firewall hardening follows InstallServices'
Assert-Static ($removeSequence.Before -eq 'RemoveFiles') 'Firewall-only cleanup runs before helper removal'
$packageText = Get-Content -LiteralPath $packagePath -Raw -Encoding utf8
Assert-Static ($packageText -notmatch '(?i)firewall.{0,80}allow|New-NetFirewallRule|netsh') 'WiX authors no inbound allow rule or shell firewall mutation'

$serviceConfig = Get-JsonFile 'config\service\appsettings.json'
$agentConfig = Get-JsonFile 'config\agent\appsettings.json'
$updateConfig = Get-JsonFile 'config\update\appsettings.json'
$recoveryConfig = Get-JsonFile 'config\recovery\appsettings.json'
$auditSignerConfig = Get-JsonFile 'config\audit-signer\appsettings.json'
$egressSupervisorConfig = Get-JsonFile 'config\egress-supervisor\appsettings.json'
$privilegedCommandSupervisorConfig = Get-JsonFile 'config\privileged-command-supervisor\appsettings.json'
$egressSupervisorRuntimeConfig = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.EgressSupervisor\appsettings.json') -Raw -Encoding utf8 | ConvertFrom-Json
$privilegedCommandSupervisorRuntimeConfig = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.PrivilegedCommandSupervisor\appsettings.json') -Raw -Encoding utf8 | ConvertFrom-Json
$updateSourceConfig = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.UpdateSupervisor\appsettings.json') -Raw -Encoding utf8 | ConvertFrom-Json
$updateProductionExample = Get-Content -LiteralPath (Join-Path $companionRoot 'config\update-supervisor.production.example.json') -Raw -Encoding utf8 | ConvertFrom-Json
$expectedHostCapabilityKeys = @(
    'Enabled', 'PermanentDeleteEnabled', 'RecoveryVaultPath', 'SecretVaultPath',
    'MaximumSearchResults', 'MaximumArgumentCount', 'MaximumArgumentLength',
    'MaximumNetworkAddresses', 'MaximumPrinterDiscoveryResults', 'MaximumSingleFileBytes',
    'MaximumArchiveEntries', 'MaximumArchiveEntryPathLength',
    'MaximumArchiveExpandedBytes', 'MaximumArchiveCompressionRatio',
    'MaximumRecoveryBytes',
    'AllowedRoots', 'AllowedFileAclProfiles', 'AllowedExecutables', 'AllowedRegistryRoots',
    'AllowedMachineEnvironmentVariables', 'AllowedWindowsServices', 'AllowedScheduledTasks',
    'AllowedMsiPackages', 'AllowedLocalAccounts', 'AllowedLocalGroups', 'AllowedLocalUserRights',
    'AllowedNetworkAdapters', 'AllowedPrinters', 'AllowedPowerSchemes', 'AllowedTimeZones'
) | Sort-Object
# The main service additionally binds the registry durable-value/delete targets
# and the inventory ceilings. The recovery supervisor deliberately does not:
# these are the executing service's surface, and a recovery-only host that
# carried them would be claiming reach it has no reason to have. One shared list
# for both hosts silently required them to stay identical, which they are not.
$expectedServiceOnlyHostCapabilityKeys = @(
    'MaximumProcessInventoryEntries', 'MaximumInstalledSoftwareInventoryEntries',
    'AllowedRegistryDurableValueTargets', 'AllowedRegistryDeleteTargets'
)
$expectedServiceHostCapabilityKeys =
    @($expectedHostCapabilityKeys + $expectedServiceOnlyHostCapabilityKeys) | Sort-Object
foreach ($packagedHost in @(
    [pscustomobject]@{
        Name = 'service'
        Value = if ($serviceConfig) { $serviceConfig.HostCapabilities } else { $null }
        Expected = $expectedServiceHostCapabilityKeys
    },
    [pscustomobject]@{
        Name = 'recovery'
        Value = if ($recoveryConfig) { $recoveryConfig.HostCapabilities } else { $null }
        Expected = $expectedHostCapabilityKeys
    }
)) {
    if ($null -eq $packagedHost.Value) { continue }
    $actualKeys = @($packagedHost.Value.PSObject.Properties.Name | Sort-Object)
    $expectedHostAllowlists = @($packagedHost.Expected | Where-Object { $_.StartsWith('Allowed', [StringComparison]::Ordinal) })
    Assert-Static (($actualKeys -join '|') -ceq ($packagedHost.Expected -join '|')) "Packaged $($packagedHost.Name) HostCapabilities has no unknown/stale/unbound keys"
    Assert-Static ($packagedHost.Value.MaximumArchiveEntries -eq 2048 -and
        $packagedHost.Value.MaximumArchiveEntryPathLength -eq 1024 -and
        $packagedHost.Value.MaximumArchiveExpandedBytes -eq 536870912 -and
        $packagedHost.Value.MaximumArchiveCompressionRatio -eq 100) "Packaged $($packagedHost.Name) ZIP extraction ceilings match the reviewed profile"
    foreach ($allowlist in $expectedHostAllowlists) {
        Assert-Static (@($packagedHost.Value.$allowlist).Count -eq 0) "Packaged $($packagedHost.Name) HostCapabilities safe-off allowlist is empty: $allowlist"
    }
}
if ($serviceConfig) {
    Assert-Static (-not $serviceConfig.Companion.ExecutionEnabled -and -not $serviceConfig.HostCapabilities.Enabled -and -not $serviceConfig.PrivilegedCommand.Enabled -and -not $serviceConfig.SystemPower.Enabled -and -not $serviceConfig.BrokerChannel.Enabled -and -not $serviceConfig.SessionBridge.Enabled -and -not $serviceConfig.SecretProvisioning.Enabled) 'Main service ships execution/broker/host/privileged-command/system-power/session/secret provisioning disabled'
    Assert-Static ($serviceConfig.SessionBridge.PipeName -ceq 'Itemba.Msaidizi.Session.v2') 'Packaged service uses the attestation-bound session protocol v2'
    $expectedPrivilegedCommandKeys = @('Enabled', 'MaximumTimeoutSeconds', 'MaximumOutputBytes', 'MaximumProcesses', 'MaximumProcessMemoryBytes', 'IsolationReplayStorePath') | Sort-Object
    $actualPrivilegedCommandKeys = @($serviceConfig.PrivilegedCommand.PSObject.Properties.Name | Sort-Object)
    $expectedIsolationReplayPath = '%ProgramData%\Itemba\Msaidizi\supervisor\privileged-command-isolation\replay.v1.jsonl'
    Assert-Static (($actualPrivilegedCommandKeys -join '|') -ceq ($expectedPrivilegedCommandKeys -join '|')) 'Packaged service PrivilegedCommand section has no unknown, stale, or model-controlled keys'
    Assert-Static (-not $serviceConfig.PrivilegedCommand.Enabled -and $serviceConfig.PrivilegedCommand.IsolationReplayStorePath -ceq $expectedIsolationReplayPath) 'Packaged privileged command remains disabled and uses the dedicated protected replay root'
    $expectedEgressReplayPath = '%ProgramData%\Itemba\Msaidizi\supervisor\egress-boundary\receipts.v1.jsonl'
    Assert-Static ($serviceConfig.Companion.EgressReceiptReplayPath -ceq $expectedEgressReplayPath) 'Packaged service binds egress receipts to the dedicated protected replay root'
    $expectedSystemPowerKeys = @('Enabled', 'RestartDelaySeconds') | Sort-Object
    $actualSystemPowerKeys = @($serviceConfig.SystemPower.PSObject.Properties.Name | Sort-Object)
    Assert-Static (($actualSystemPowerKeys -join '|') -ceq ($expectedSystemPowerKeys -join '|')) 'Packaged service SystemPower section has no unknown, stale, or model-controlled keys'
    Assert-Static (-not $serviceConfig.SystemPower.Enabled -and $serviceConfig.SystemPower.RestartDelaySeconds -eq 120) 'Packaged restart capability is disabled with the fixed 120-second supervisor delay'
    Assert-Static ($serviceConfig.Companion.DeviceId -eq 'UNENROLLED') 'Main service requires explicit enrollment identity'
    Assert-Static ($serviceConfig.BrokerChannel.Endpoint -ceq 'https://provisioning-required.invalid:3443/api/v1/msaidizi/devices/channel') 'Packaged service demonstrates the dedicated direct-mTLS device listener while remaining disabled'
    Assert-Static ($serviceConfig.BrokerChannel.RequireHardwareBackedDeviceIdentity -and -not $serviceConfig.BrokerChannel.DevelopmentOnlyAllowSoftwareDeviceIdentity -and $serviceConfig.BrokerChannel.PreferTpm) 'Main service requires TPM-backed device identity and disables the development-only Software KSP override'
    Assert-Static (@($serviceConfig.TokenVerification.TrustedSigningCertificates).Count -eq 0) 'Main service ships no trusted action signer'
    Assert-Static (-not $serviceConfig.EgressAttestationTrust.Enabled -and @($serviceConfig.EgressAttestationTrust.TrustedSupervisorCertificates).Count -eq 0 -and @($serviceConfig.EgressAttestationTrust.PairedDeviceCertificateThumbprints).Count -eq 0) 'Main service ships egress attestation trust disabled and unprovisioned'
    $expectedEgressTrustKeys = @('Enabled', 'TrustedSupervisorCertificates', 'PairedDeviceCertificateThumbprints') | Sort-Object
    $actualEgressTrustKeys = @($serviceConfig.EgressAttestationTrust.PSObject.Properties.Name | Sort-Object)
    Assert-Static (($actualEgressTrustKeys -join '|') -ceq ($expectedEgressTrustKeys -join '|')) 'Packaged service EgressAttestationTrust section has no unknown/stale/unbound keys'
    Assert-Static (@($serviceConfig.HostCapabilities.AllowedRoots).Count -eq 0 -and @($serviceConfig.HostCapabilities.AllowedExecutables).Count -eq 0) 'Main service ships no host allowlist'
    $expectedSecretProvisioningKeys = @('Enabled', 'PipeName', 'AllowedAgentExecutableSha256', 'AuditJournalPath', 'MaximumFrameBytes', 'ConfirmationTtlSeconds', 'RequireActiveConsoleSession', 'Bindings') | Sort-Object
    $actualSecretProvisioningKeys = @($serviceConfig.SecretProvisioning.PSObject.Properties.Name | Sort-Object)
    Assert-Static (($actualSecretProvisioningKeys -join '|') -ceq ($expectedSecretProvisioningKeys -join '|')) 'Packaged service SecretProvisioning section has no unknown/stale/unbound keys'
    Assert-Static (@($serviceConfig.SecretProvisioning.Bindings).Count -eq 0) 'Packaged service ships no secret destination bindings'
    Assert-Static (-not $serviceConfig.EgressSupervisorClient.Enabled -and
        $serviceConfig.EgressSupervisorClient.Transport -ceq 'disabled' -and
        [string]::IsNullOrEmpty([string]$serviceConfig.EgressSupervisorClient.PipeName) -and
        [string]::IsNullOrEmpty([string]$serviceConfig.EgressSupervisorClient.ExpectedSupervisorImageSha256) -and
        [string]::IsNullOrEmpty([string]$serviceConfig.EgressSupervisorClient.ExpectedSupervisorPipeSecuritySha256) -and
        -not $serviceConfig.EgressSupervisorFlowClient.Enabled -and
        [string]::IsNullOrEmpty([string]$serviceConfig.EgressSupervisorFlowClient.PipeName)) 'Packaged companion egress clients require exact deployment-owned provisioning'
    Assert-Static (-not $serviceConfig.PrivilegedCommandIsolationClient.Enabled -and
        $serviceConfig.PrivilegedCommandIsolationClient.Transport -ceq 'disabled' -and
        $serviceConfig.PrivilegedCommandIsolationClient.ProtocolVersion -eq 2 -and
        [string]::IsNullOrEmpty([string]$serviceConfig.PrivilegedCommandIsolationClient.PipeName) -and
        [string]::IsNullOrEmpty([string]$serviceConfig.PrivilegedCommandIsolationClient.ExpectedDriverMeasurementSha256) -and
        [string]::IsNullOrEmpty([string]$serviceConfig.PrivilegedCommandIsolationClient.ReservationLeasePublicKey.KeyId) -and
        [string]::IsNullOrEmpty([string]$serviceConfig.PrivilegedCommandIsolationClient.TerminalEnforcementReceiptPublicKey.SubjectPublicKeyInfoBase64)) 'Packaged privileged-command isolation client retains the non-accepting fallback until exact trust provisioning'
}
$systemPowerSourcePath = Join-Path $installerRoot '..\src\Msaidizi.Companion.Service\Capabilities\SystemPowerCapabilityAdapters.cs'
$systemPowerSource = Get-Content -LiteralPath $systemPowerSourcePath -Raw -Encoding utf8
Assert-Static ($systemPowerSource -match 'InitiateSystemShutdownExW' -and $systemPowerSource -match 'forceAppsClosed:\s*false' -and $systemPowerSource -match 'rebootAfterShutdown:\s*true') 'System restart uses the direct non-forcing native reboot API'
Assert-Static ($systemPowerSource -notmatch '(?i)ProcessStartInfo|powershell(?:\.exe)?|cmd\.exe') 'System restart implementation has no shell or arbitrary-process fallback'
$serviceStartModeSourcePath = Join-Path $installerRoot '..\src\Msaidizi.Companion.Service\Capabilities\WindowsServiceStartModeCapabilityAdapters.cs'
$serviceStartModeSource = Get-Content -LiteralPath $serviceStartModeSourcePath -Raw -Encoding utf8
Assert-Static ($serviceStartModeSource -match 'QueryServiceConfigW' -and $serviceStartModeSource -match 'ChangeServiceConfigW' -and $serviceStartModeSource -match 'MaximumQueryConfigBytes\s*=\s*8\s*\*\s*1024') 'Windows service start mode uses the bounded direct SCM configuration APIs'
Assert-Static ($serviceStartModeSource -match 'serviceType:\s*ServiceNoChange' -and $serviceStartModeSource -match 'errorControl:\s*ServiceNoChange' -and $serviceStartModeSource -match 'binaryPathName:\s*null' -and $serviceStartModeSource -match 'serviceStartName:\s*null') 'Windows service mutation changes only the base SCM start type'
Assert-Static ($serviceStartModeSource -notmatch '(?i)ProcessStartInfo|powershell(?:\.exe)?|cmd\.exe') 'Windows service start-mode implementation has no shell or arbitrary-process fallback'
$servicePolicySourcePath = Join-Path $installerRoot '..\src\Msaidizi.Companion.Service\Capabilities\WindowsServiceCapabilityAdapters.cs'
$servicePolicySource = Get-Content -LiteralPath $servicePolicySourcePath -Raw -Encoding utf8
Assert-Static ($servicePolicySource -match 'AllowedStartModes' -and $servicePolicySource -match 'companion' -and $servicePolicySource -match 'update' -and $servicePolicySource -match 'recovery' -and $servicePolicySource -match 'supervisor' -and $servicePolicySource -match 'audit') 'Windows service policy retains the exact start-mode allowlist and every trusted Msaidizi service-family exclusion'
Assert-Static ($serviceStartModeSource -match 'Win32OwnProcess' -and $serviceStartModeSource -match 'Win32ShareProcess' -and $serviceStartModeSource -match 'windows_service_pre_state_changed' -and $serviceStartModeSource -match 'cancellationToken\.ThrowIfCancellationRequested\(\)') 'Windows service mutation rejects drivers and retains same-handle pre-state/cancellation commit guards'
Assert-Static ($serviceStartModeSource -match 'configurationIdentitySha256' -and $serviceStartModeSource -match 'windows-service-base-configuration/v1' -and $serviceStartModeSource -match 'ReadBoundedMultiString' -and $serviceStartModeSource -match 'FixedTimeEqualsHex') 'Windows service signed pre-state binds and rechecks the bounded base SCM configuration fingerprint'
$serviceProductionExamplePath = Join-Path $installerRoot '..\config\service.production.example.json'
$serviceProductionExample = Get-Content -LiteralPath $serviceProductionExamplePath -Raw -Encoding utf8 | ConvertFrom-Json
$recoveryProductionExample = Get-Content -LiteralPath (Join-Path $companionRoot 'config\recovery-supervisor.production.example.json') -Raw -Encoding utf8 | ConvertFrom-Json
$auditSignerProductionExample = Get-Content -LiteralPath (Join-Path $companionRoot 'config\audit-signer.production.example.json') -Raw -Encoding utf8 | ConvertFrom-Json
Assert-Static (-not $serviceProductionExample.PrivilegedCommand.Enabled -and
    $serviceProductionExample.PrivilegedCommand.IsolationReplayStorePath -ceq '%ProgramData%\Itemba\Msaidizi\supervisor\privileged-command-isolation\replay.v1.jsonl' -and
    $serviceProductionExample.PrivilegedCommandIsolationClient.ProtocolVersion -eq 2) 'Production example keeps privileged command disabled and binds its replay ledger/client to the protected v2 isolation contract'
Assert-Static ($serviceProductionExample.Companion.EgressReceiptReplayPath -ceq '%ProgramData%\Itemba\Msaidizi\supervisor\egress-boundary\receipts.v1.jsonl') 'Production example binds egress receipts to the dedicated protected replay root'
Assert-Static ($serviceProductionExample.BrokerChannel.Endpoint -ceq 'https://msaidizi-broker.example.invalid:3443/api/v1/msaidizi/devices/channel' -and
    $updateProductionExample.MsaidiziUpdateSupervisor.BrokerBaseUri -ceq 'https://msaidizi-broker.example.invalid:3443/api/v1/' -and
    $recoveryProductionExample.MsaidiziRecoverySupervisor.BrokerBaseUri -ceq 'https://msaidizi-broker.example.invalid:3443/api/v1/' -and
    $auditSignerProductionExample.MsaidiziAuditSigner.BrokerBaseUri -ceq 'https://msaidizi-broker.example.invalid:3443/api/v1/') 'Production examples use the dedicated direct-mTLS listener for device, update, recovery, and audit channels'
$productionEgressEndpoints = @($serviceProductionExample.ExternalActions.Endpoints)
Assert-Static ($productionEgressEndpoints.Count -gt 0 -and @($productionEgressEndpoints | Where-Object {
        [string]::IsNullOrWhiteSpace([string]$_.CredentialRecordSha256) -or
        [string]$_.CredentialRecordSha256 -cnotmatch '^REPLACE_WITH_EXACT_DPAPI_V2_VAULT_RECORD_SHA256$'
    }).Count -eq 0) 'Production example requires the exact DPAPI v2 credential-record digest for every egress endpoint'
foreach ($allowedService in @($serviceProductionExample.HostCapabilities.AllowedWindowsServices)) {
    $modeProperties = @($allowedService.PSObject.Properties | Where-Object { $_.Name -ceq 'AllowedStartModes' })
    $modes = @($allowedService.AllowedStartModes)
    Assert-Static ($modeProperties.Count -eq 1 -and @($modes | Where-Object { $_ -cnotin @('automatic', 'manual', 'disabled') }).Count -eq 0 -and @($modes | Select-Object -Unique).Count -eq $modes.Count) "Production example has one exact reviewed start-mode allowlist: $($allowedService.Id)"
}
if ($agentConfig) {
    Assert-Static (-not $agentConfig.Agent.ExecutionEnabled -and -not $agentConfig.SessionBridge.Enabled -and -not $agentConfig.SecretProvisioning.Enabled) 'Agent ships execution/session/secret provisioning disabled'
    $expectedAgentKeys = @(
        'DeviceId', 'ExecutionEnabled', 'HeartbeatSeconds', 'KillSwitchPath',
        'EgressDestinationPolicySha256',
        'MaximumActionWallTimeSeconds', 'MaximumActionBytes', 'MaximumCameraBytes',
        'MaximumSpeechAudioBytes', 'MaximumTranscriptCharacters', 'SessionRecoveryPath',
        'AllowedBrowserOrigins', 'AllowedUiProcesses', 'AllowedBrowserUploadRoots',
        'AllowedCameras', 'AllowedSpeechVoices', 'AllowedOfflineSpeechRecognizers',
        'MaximumCommandOutputBytes', 'MaximumCommandProcesses', 'MaximumCommandWorkingSetBytes',
        'AllowedCommandWorkingDirectories', 'ProtectedSupervisorPaths'
    ) | Sort-Object
    $actualAgentKeys = @($agentConfig.Agent.PSObject.Properties.Name | Sort-Object)
    Assert-Static (($actualAgentKeys -join '|') -ceq ($expectedAgentKeys -join '|')) 'Packaged Agent section has no unknown/stale/unbound keys'
    foreach ($allowlist in @($expectedAgentKeys | Where-Object { $_.StartsWith('Allowed', [StringComparison]::Ordinal) })) {
        Assert-Static (@($agentConfig.Agent.$allowlist).Count -eq 0) "Packaged Agent safe-off allowlist is empty: $allowlist"
    }
    Assert-Static ($agentConfig.Agent.DeviceId -eq 'UNENROLLED') 'Packaged agent requires explicit enrollment identity'
    $expectedCapabilityBoundaryTrustKeys = @('Enabled', 'KeyId', 'CertificateThumbprint', 'CertificateStoreName', 'CertificateStoreLocation', 'ExpectedSupervisorPipeSecuritySha256', 'AllowedClockSkewSeconds', 'MaximumAttestationLifetimeSeconds') | Sort-Object
    $actualCapabilityBoundaryTrustKeys = @($agentConfig.CapabilityBoundaryTrust.PSObject.Properties.Name | Sort-Object)
    Assert-Static (($actualCapabilityBoundaryTrustKeys -join '|') -ceq ($expectedCapabilityBoundaryTrustKeys -join '|')) 'Packaged Agent capability-boundary trust has only reviewed pins and time limits'
    Assert-Static (-not $agentConfig.CapabilityBoundaryTrust.Enabled -and
        [string]::IsNullOrEmpty([string]$agentConfig.Agent.EgressDestinationPolicySha256) -and
        [string]::IsNullOrEmpty([string]$agentConfig.CapabilityBoundaryTrust.KeyId) -and
        [string]::IsNullOrEmpty([string]$agentConfig.CapabilityBoundaryTrust.CertificateThumbprint) -and
        [string]::IsNullOrEmpty([string]$agentConfig.CapabilityBoundaryTrust.ExpectedSupervisorPipeSecuritySha256)) 'Packaged Agent cannot self-attest an external-effect boundary'
    Assert-Static ($agentConfig.SessionBridge.PipeName -ceq 'Itemba.Msaidizi.Session.v2') 'Packaged Agent uses the attestation-bound session protocol v2'
    $expectedAgentSecretKeys = @('Enabled', 'PipeName', 'ServiceCertificateThumbprint', 'ServiceCertificateStoreName', 'ServiceCertificateStoreLocation', 'ConnectTimeoutSeconds', 'MaximumFrameBytes', 'PendingRequestPath') | Sort-Object
    $actualAgentSecretKeys = @($agentConfig.SecretProvisioning.PSObject.Properties.Name | Sort-Object)
    Assert-Static (($actualAgentSecretKeys -join '|') -ceq ($expectedAgentSecretKeys -join '|')) 'Packaged agent SecretProvisioning section has no unknown/stale/unbound keys'
}
if ($updateConfig) {
    Assert-Static ([string]::IsNullOrEmpty([string]$updateConfig.MsaidiziUpdateSupervisor.ClientCertificateThumbprint) -and $updateConfig.MsaidiziUpdateSupervisor.BootstrapKeyId -eq 'PROVISIONING_REQUIRED') 'Update supervisor requires explicit identity/bootstrap provisioning'
    Assert-Static ($updateConfig.MsaidiziUpdateSupervisor.BrokerBaseUri -ceq 'https://provisioning-required.invalid:3443/api/v1/') 'Packaged update supervisor demonstrates the dedicated direct-mTLS listener while remaining unprovisioned'
    $expectedUpdatePointer = '%ProgramData%\Itemba\Msaidizi\application-state\active-application.txt'
    $updatePointers = @(
        [string]$updateConfig.MsaidiziUpdateSupervisor.Targets[0].ActivePointerPath,
        [string]$updateSourceConfig.MsaidiziUpdateSupervisor.Targets[0].ActivePointerPath,
        [string]$updateProductionExample.MsaidiziUpdateSupervisor.Targets[0].ActivePointerPath
    )
    Assert-Static (@($updatePointers | Where-Object { $_ -cne $expectedUpdatePointer }).Count -eq 0) 'All update-supervisor configs use the restricted-SID-writable application-state pointer'
}
if ($recoveryConfig) {
    Assert-Static (-not $recoveryConfig.Companion.ExecutionEnabled -and -not $recoveryConfig.BrokerChannel.Enabled) 'Recovery service ships companion/broker execution disabled'
    Assert-Static ($recoveryConfig.MsaidiziRecoverySupervisor.BrokerBaseUri -ceq 'https://provisioning-required.invalid:3443/api/v1/') 'Packaged recovery supervisor demonstrates the dedicated direct-mTLS listener while remaining unprovisioned'
    Assert-Static ($recoveryConfig.BrokerChannel.RequireHardwareBackedDeviceIdentity -and -not $recoveryConfig.BrokerChannel.DevelopmentOnlyAllowSoftwareDeviceIdentity -and $recoveryConfig.BrokerChannel.PreferTpm) 'Recovery service preserves the production TPM-backed device identity policy'
    Assert-Static (@($recoveryConfig.HostCapabilities.AllowedRoots).Count -eq 0 -and @($recoveryConfig.HostCapabilities.AllowedExecutables).Count -eq 0) 'Recovery service ships no operational allowlist'
}
if ($auditSignerConfig) {
    Assert-Static ([string]::IsNullOrEmpty([string]$auditSignerConfig.MsaidiziAuditSigner.ClientCertificateThumbprint) -and $auditSignerConfig.MsaidiziAuditSigner.SignerKeyId -eq 'PROVISIONING_REQUIRED') 'Audit signer requires explicit hardware identity provisioning'
    Assert-Static ($auditSignerConfig.MsaidiziAuditSigner.HardwareKeyProvider -eq 'Microsoft Platform Crypto Provider') 'Audit signer requires the TPM CNG provider'
    Assert-Static ($auditSignerConfig.MsaidiziAuditSigner.BrokerBaseUri -ceq 'https://provisioning-required.invalid:3443/api/v1/' -and $auditSignerConfig.MsaidiziAuditSigner.PinnedBrokerCertificateSha256 -eq ('0' * 64) -and $auditSignerConfig.MsaidiziAuditSigner.PinnedBrokerSpkiSha256 -eq ('0' * 64)) 'Audit signer demonstrates the dedicated direct-mTLS listener and broker pins fail closed until provisioning'
}
if ($egressSupervisorConfig) {
    $egressSafe = $egressSupervisorConfig.EgressSupervisor
    $egressPackagedKeys = @($egressSafe.PSObject.Properties.Name | Sort-Object)
    $egressRuntimeKeys = @($egressSupervisorRuntimeConfig.EgressSupervisor.PSObject.Properties.Name | Sort-Object)
    Assert-Static (($egressPackagedKeys -join '|') -ceq ($egressRuntimeKeys -join '|')) 'Packaged egress supervisor config has the exact runtime option schema'
    Assert-Static (-not $egressSafe.Enabled -and -not $egressSafe.DriverActive -and
        -not $egressSafe.SecureBootEnabled -and -not $egressSafe.HvciEnabled -and
        [string]::IsNullOrEmpty([string]$egressSafe.AgentImagePath) -and
        [string]::IsNullOrEmpty([string]$egressSafe.AgentImageSha256) -and
        $egressSafe.CapabilityAttestationLifetimeSeconds -eq 60) 'Egress supervisor ships safe-off without invented platform, driver, or Agent measurement posture'
    Assert-Static ($egressSafe.ExpectedIssuer -ceq 'itemba-msaidizi-broker' -and
        $egressSafe.ExpectedAudience -ceq 'itemba-windows-companion' -and
        $egressSafe.ExpectedSubject -ceq 'msaidizi-global' -and
        $egressSafe.FlowOperationTimeoutSeconds -eq 120 -and
        $egressSafe.MaximumRequestBytes -eq 1048576 -and
        $egressSafe.MaximumResponseBytes -eq 16777216 -and
        $egressSafe.FlowCompletionSettlementTimeoutMilliseconds -eq 5000) 'Egress supervisor token identity and bounded exact-request flow settings match the runtime contract'
    Assert-Static ($egressSafe.JournalPath -ceq 'C:\ProgramData\Itemba\Msaidizi\supervisor\egress-supervisor\lifecycle.v2.jsonl' -and
        $egressSafe.KillSwitchPath -ceq 'C:\ProgramData\Itemba\Msaidizi\supervisor\DISABLED' -and
        $egressSafe.SecretVaultPath -ceq 'C:\ProgramData\Itemba\Msaidizi\supervisor\secret-vault' -and
        [string]::IsNullOrEmpty([string]$egressSafe.DestinationPolicyPath) -and
        [string]::IsNullOrEmpty([string]$egressSafe.AttestationCertificateThumbprint) -and
        [string]::IsNullOrEmpty([string]$egressSafe.ReceiptCertificateThumbprint)) 'Egress supervisor owns its dedicated journal and requires policy/signing provisioning'
}
if ($privilegedCommandSupervisorConfig) {
    $isolationSafe = $privilegedCommandSupervisorConfig.PrivilegedCommandSupervisor
    $isolationPackagedKeys = @($isolationSafe.PSObject.Properties.Name | Sort-Object)
    $isolationRuntimeKeys = @($privilegedCommandSupervisorRuntimeConfig.PrivilegedCommandSupervisor.PSObject.Properties.Name | Sort-Object)
    Assert-Static (($isolationPackagedKeys -join '|') -ceq ($isolationRuntimeKeys -join '|')) 'Packaged privileged-command supervisor config has the exact runtime option schema'
    Assert-Static (-not $isolationSafe.Enabled -and
        $isolationSafe.DeviceId -ceq '00000000-0000-0000-0000-000000000000' -and
        $isolationSafe.PipeName -ceq 'Itemba.Msaidizi.PrivilegedCommandIsolation.v2' -and
        $isolationSafe.SupervisorServiceSid -ceq 'S-1-5-80-1792805186-3282615177-1795010573-3676175622-4117989893' -and
        $isolationSafe.AllowedCompanionServiceSid -ceq 'S-1-5-80-341263411-3719254221-1864525750-3877438856-2718495063' -and
        $isolationSafe.DriverMeasurementSha256 -ceq ('0' * 64)) 'Privileged-command supervisor ships safe-off without invented identity, signing, or driver evidence'
    $isolationSigningKeys = [ordered]@{
        ReservationLeaseSigningKey = [ordered]@{ KeyId = 'reservation-lease-v1'; Thumbprint = ('0' * 40); CompanionPublicKey = 'ReservationLeasePublicKey' }
        PreBindReservationReleaseSigningKey = [ordered]@{ KeyId = 'pre-bind-reservation-release-v1'; Thumbprint = ('1' * 40); CompanionPublicKey = 'PreBindReservationReleasePublicKey' }
        SuspendedProcessBindAcknowledgementSigningKey = [ordered]@{ KeyId = 'suspended-process-bind-acknowledgement-v1'; Thumbprint = ('2' * 40); CompanionPublicKey = 'SuspendedProcessBindAcknowledgementPublicKey' }
        TerminalEnforcementReceiptSigningKey = [ordered]@{ KeyId = 'terminal-enforcement-receipt-v1'; Thumbprint = ('3' * 40); CompanionPublicKey = 'TerminalEnforcementReceiptPublicKey' }
    }
    $packagedIsolationKeyIds = [Collections.Generic.List[string]]::new()
    $packagedIsolationThumbprints = [Collections.Generic.List[string]]::new()
    foreach ($bindingName in $isolationSigningKeys.Keys) {
        $binding = $isolationSafe.$bindingName
        $expectedBinding = $isolationSigningKeys[$bindingName]
        $bindingProperties = @($binding.PSObject.Properties.Name | Sort-Object)
        $expectedBindingProperties = @('CertificateThumbprint', 'KeyId', 'SubjectPublicKeyInfoBase64') | Sort-Object
        Assert-Static (($bindingProperties -join '|') -ceq ($expectedBindingProperties -join '|')) "Isolation signing binding has only exact fields: $bindingName"
        Assert-Static ($binding.KeyId -ceq $expectedBinding.KeyId -and
            $binding.CertificateThumbprint -ceq $expectedBinding.Thumbprint -and
            [string]::IsNullOrEmpty([string]$binding.SubjectPublicKeyInfoBase64)) "Isolation signing binding is distinct and safe-off: $bindingName"
        $companionPublicKey = $serviceConfig.PrivilegedCommandIsolationClient.($expectedBinding.CompanionPublicKey)
        Assert-Static ([string]::IsNullOrEmpty([string]$companionPublicKey.KeyId) -and
            [string]::IsNullOrEmpty([string]$companionPublicKey.SubjectPublicKeyInfoBase64) -and
            [string]::IsNullOrEmpty([string]$binding.SubjectPublicKeyInfoBase64)) "Isolation signing binding has its safe-off same-purpose Companion public-key slot: $bindingName"
        $packagedIsolationKeyIds.Add([string]$binding.KeyId)
        $packagedIsolationThumbprints.Add([string]$binding.CertificateThumbprint)
    }
    $isolationVerificationKeys = [ordered]@{
        ActionTokenVerificationKey = [ordered]@{ KeyId = 'msaidizi-action-token-v1'; Thumbprint = ('4' * 40) }
        DriverAttestationVerificationKey = [ordered]@{ KeyId = 'isolation-driver-attestation-v2'; Thumbprint = ('5' * 40) }
    }
    foreach ($bindingName in $isolationVerificationKeys.Keys) {
        $binding = $isolationSafe.$bindingName
        $expectedBinding = $isolationVerificationKeys[$bindingName]
        $bindingProperties = @($binding.PSObject.Properties.Name | Sort-Object)
        $expectedBindingProperties = @('CertificateThumbprint', 'KeyId', 'SubjectPublicKeyInfoBase64') | Sort-Object
        Assert-Static (($bindingProperties -join '|') -ceq ($expectedBindingProperties -join '|')) "Isolation verification binding has only exact fields: $bindingName"
        Assert-Static ($binding.KeyId -ceq $expectedBinding.KeyId -and
            $binding.CertificateThumbprint -ceq $expectedBinding.Thumbprint -and
            [string]::IsNullOrEmpty([string]$binding.SubjectPublicKeyInfoBase64)) "Isolation verification binding is purpose-distinct and safe-off: $bindingName"
        $packagedIsolationKeyIds.Add([string]$binding.KeyId)
        $packagedIsolationThumbprints.Add([string]$binding.CertificateThumbprint)
    }
    Assert-Static (@($packagedIsolationKeyIds | Select-Object -Unique).Count -eq 6 -and
        @($packagedIsolationThumbprints | Select-Object -Unique).Count -eq 6) 'Isolation safe-off key IDs and certificate placeholders remain pairwise distinct across four signing and two verification purposes'
    Assert-Static ($isolationSafe.ActionTokenExpectedIssuer -ceq 'itemba-msaidizi-broker' -and
        $isolationSafe.ActionTokenExpectedAudience -ceq 'itemba-windows-companion' -and
        $isolationSafe.ActionTokenExpectedSubject -ceq 'msaidizi-global' -and
        $isolationSafe.ActionTokenAllowedClockSkew -ceq '00:00:30' -and
        $isolationSafe.ActionTokenMaximumLifetime -ceq '00:05:00' -and
        $privilegedCommandSupervisorRuntimeConfig.PrivilegedCommandSupervisor.ActionTokenExpectedIssuer -ceq $isolationSafe.ActionTokenExpectedIssuer -and
        $privilegedCommandSupervisorRuntimeConfig.PrivilegedCommandSupervisor.ActionTokenExpectedAudience -ceq $isolationSafe.ActionTokenExpectedAudience -and
        $privilegedCommandSupervisorRuntimeConfig.PrivilegedCommandSupervisor.ActionTokenExpectedSubject -ceq $isolationSafe.ActionTokenExpectedSubject) 'Isolation runtime and packaged supervisor independently verify the existing exact broker action-token trust scope'
    Assert-Static ($isolationSafe.DriverServiceName -ceq 'Itemba Msaidizi Privileged Command Isolation Driver' -and
        $isolationSafe.DriverPolicyEpoch -ceq 'isolation-policy-v2' -and
        $isolationSafe.DriverAttestationAllowedClockSkew -ceq '00:00:30' -and
        $isolationSafe.DriverAttestationMaximumLifetime -ceq '00:01:00' -and
        $isolationSafe.MaximumInvocationTimeoutSeconds -eq 300 -and
        $isolationSafe.MaximumInvocationOutputBytes -eq 1048576 -and
        $isolationSafe.MaximumInvocationProcesses -eq 16 -and
        $isolationSafe.MaximumInvocationProcessMemoryBytes -eq 536870912) 'Isolation supervisor pins the native driver trust scope and exact per-invocation resource ceilings'
    Assert-Static ($isolationSafe.StateRoot -ceq 'C:\ProgramData\Itemba\Msaidizi\supervisor\privileged-command-supervisor' -and
        $isolationSafe.JournalPath -ceq 'C:\ProgramData\Itemba\Msaidizi\supervisor\privileged-command-supervisor\lifecycle.v1.jsonl') 'Privileged-command supervisor owns its dedicated lifecycle root and journal'
}

$hardeningRoot = Join-Path $installerRoot 'src\Itemba.Msaidizi.Installer.Hardening'
$hardeningSources = (Get-ChildItem -LiteralPath $hardeningRoot -File -Filter '*.cs' | Get-Content -Raw) -join "`n"
$canonicalRootSource = Get-Content -LiteralPath (Join-Path $hardeningRoot 'CanonicalDataRootGuard.cs') -Raw -Encoding utf8
$handleBoundSource = Get-Content -LiteralPath (Join-Path $hardeningRoot 'HandleBoundPathSecurity.cs') -Raw -Encoding utf8
$configurationProvenanceSource = Get-Content -LiteralPath (Join-Path $hardeningRoot 'ConfigurationProvenance.cs') -Raw -Encoding utf8
$aclHardenerSource = Get-Content -LiteralPath (Join-Path $hardeningRoot 'AclHardener.cs') -Raw -Encoding utf8
$hardeningProgramSource = Get-Content -LiteralPath (Join-Path $hardeningRoot 'Program.cs') -Raw -Encoding utf8
$hardeningProjectSource = Get-Content -LiteralPath (Join-Path $hardeningRoot 'Itemba.Msaidizi.Installer.Hardening.csproj') -Raw -Encoding utf8
$egressLifecycleStoreSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.EgressSupervisor\Persistence\DurableEgressJournal.cs') -Raw -Encoding utf8
$egressJournalProtectionSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.EgressSupervisor\Persistence\WindowsEgressJournalProtection.cs') -Raw -Encoding utf8
$egressDestinationPolicySource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.EgressSupervisor\Core\EgressDestinationPolicy.cs') -Raw -Encoding utf8
$egressSecretVaultSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.EgressSupervisor\Security\EgressSupervisorSecretVault.cs') -Raw -Encoding utf8
$egressSupervisorEngineSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.EgressSupervisor\Core\EgressSupervisorEngine.cs') -Raw -Encoding utf8
$egressHostPostureSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.EgressSupervisor\Security\EgressHostPosture.cs') -Raw -Encoding utf8
$privilegedCommandLifecycleStoreSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.PrivilegedCommandSupervisor\State\FileIsolationLifecycleStore.cs') -Raw -Encoding utf8
$privilegedCommandJournalProtectionSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.PrivilegedCommandSupervisor\State\WindowsIsolationJournalProtection.cs') -Raw -Encoding utf8
$privilegedCommandProgramSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.PrivilegedCommandSupervisor\Program.cs') -Raw -Encoding utf8
$privilegedCommandOptionsSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.PrivilegedCommandSupervisor\Configuration\PrivilegedCommandSupervisorOptions.cs') -Raw -Encoding utf8
$privilegedCommandEngineSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.PrivilegedCommandSupervisor\Execution\IsolationLifecycleEngine.cs') -Raw -Encoding utf8
$privilegedCommandVerificationKeysSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.PrivilegedCommandSupervisor\Security\PinnedVerificationKeys.cs') -Raw -Encoding utf8
$privilegedCommandHostPostureSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.PrivilegedCommandSupervisor\Security\WindowsIsolationHostPosture.cs') -Raw -Encoding utf8
$privilegedCommandDriverClientSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.PrivilegedCommandSupervisor\Enforcement\WindowsKernelIsolationDriverClient.cs') -Raw -Encoding utf8
$privilegedCommandDriverAttestationValidatorSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.PrivilegedCommandSupervisor\Enforcement\SignedDriverAttestationValidator.cs') -Raw -Encoding utf8
$privilegedCommandContractsSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.Companion.Contracts\Security\PrivilegedCommandIsolationContracts.cs') -Raw -Encoding utf8
foreach ($forbidden in @('File.Delete(', 'Directory.Delete(', 'Process.Start(', 'cmd.exe', 'powershell.exe', 'Remove-Item')) {
    Assert-Static ($hardeningSources.IndexOf($forbidden, [StringComparison]::OrdinalIgnoreCase) -lt 0) "Installer helper excludes destructive/shell API: $forbidden"
}
Assert-Static ($hardeningSources -match 'ValidateBinaryRoot' -and $hardeningSources -match 'ValidateForInstall' -and $hardeningSources -match 'ValidateExactRoot' -and $hardeningSources -match 'RejectReparsePoints') 'Helper validates exact canonical roots and rejects reparse points'
Assert-Static ($hardeningSources -match 'RecoveryOperatorsGroup' -and $hardeningSources -match 'secret-vault' -and $hardeningSources -match 'secret-provisioning' -and $hardeningSources -match 'recovery-vault' -and $hardeningSources -match 'egress-boundary' -and $hardeningSources -match 'privileged-command-isolation' -and $hardeningSources -match 'egress-supervisor' -and $hardeningSources -match 'privileged-command-supervisor' -and
    $aclHardenerSource -match 'Definition\(@"supervisor\\secret-vault"[\s\S]*?InstallerPrincipal\.CompanionService, Change[\s\S]*?InstallerPrincipal\.EgressSupervisor, Read') 'Helper separates operator, replay, supervisor journals, provisioning/recovery state, and grants the egress supervisor read-only credential-vault access'
Assert-Static ($canonicalRootSource -match 'OpenDirectory\(layout\.CommonDataRoot\)' -and $canonicalRootSource -match 'CreateDirectoryAtomically\(layout\.DataParent' -and $canonicalRootSource -match 'CreateDirectoryAtomically\(layout\.DataRoot' -and $canonicalRootSource -match 'HasUntrustedMutationAuthority' -and $canonicalRootSource -match 'VerifyExact') 'Installer atomically acquires and exactly protects the canonical Itemba/Msaidizi ProgramData chain before trusting children'
Assert-Static ($handleBoundSource -match 'FileFlagOpenReparsePoint' -and $handleBoundSource -match 'GetFinalPathNameByHandle' -and $handleBoundSource -match 'information\.NumberOfLinks != 1' -and $handleBoundSource -match 'expectDirectory \? FileShare\.Read \| FileShare\.Write : FileShare\.Read' -and $handleBoundSource -match 'HasUntrustedMutationAuthority' -and $handleBoundSource -match 'Inherit-only write grants are still unsafe') 'Installer uses canonical handle-bound non-reparse/single-link validation and rejects current or inherited untrusted writers'
Assert-Static ($configurationProvenanceSource -match 'ValidateFirstInstallInventory' -and $configurationProvenanceSource -match 'SequenceEqual\(expected\)' -and $configurationProvenanceSource -match 'RejectDuplicateProperties' -and $configurationProvenanceSource -match 'MarkerBytes' -and $configurationProvenanceSource -match 'unexpected file') 'First install accepts only exact embedded fail-closed JSON and an allowlisted non-reparse inventory'
Assert-Static ($aclHardenerSource.Contains('@"supervisor\egress-supervisor\lifecycle.v2.jsonl.lock"') -and
    $egressLifecycleStoreSource.Contains('_requirePreprovisionedFiles ? FileMode.Open : FileMode.OpenOrCreate') -and
    $egressLifecycleStoreSource.Contains('FileShare.None') -and
    $egressLifecycleStoreSource.Contains('_protection!.ValidatePreOpen(') -and
    $egressLifecycleStoreSource.Contains('_protection?.ValidateOpened(') -and
    $egressJournalProtectionSource.Contains('ControlFlags.DiscretionaryAclProtected') -and
    $egressJournalProtectionSource.Contains('options.SupervisorServiceName') -and
    $egressJournalProtectionSource.Contains('FileSystemRights.FullControl') -and
    $egressJournalProtectionSource.Contains('FileSystemRights.Modify') -and
    $egressJournalProtectionSource.Contains('FileSystemRights.ReadAndExecute')) 'Egress runtime requires both installer-precreated lifecycle files and the shared exact owner/DACL/final-path contract'
$egressExactRequestMethod = [regex]::Match(
    $egressDestinationPolicySource,
    '(?s)public static string ExactRequestPolicySha256\(.*?(?=\r?\n  public static EgressDestinationPolicy Load\()')
$egressDestinationScopeMethod = [regex]::Match(
    $egressDestinationPolicySource,
    '(?s)private static string ComputeDestinationScopeSha256\(.*?(?=\r?\n  private static bool IsCanonicalSha256\()')
Assert-Static ($egressDestinationPolicySource.Contains('string CredentialRecordSha256') -and
    $egressExactRequestMethod.Success -and
    $egressExactRequestMethod.Value.Contains('entry.CredentialRecordSha256') -and
    $egressExactRequestMethod.Value.Contains('MSAIDIZI-EGRESS-EXACT-REQUEST-POLICY-V1') -and
    $egressDestinationScopeMethod.Success -and
    $egressDestinationScopeMethod.Value.Contains('EgressExternalActionCanonical.DestinationScopeSha256(') -and
    -not $egressDestinationScopeMethod.Value.Contains('CredentialRecordSha256') -and
    $egressSecretVaultSource.Contains('observedRecordSha256') -and
    $egressSecretVaultSource.Contains('PayloadDigest.FixedTimeEqualsHex(') -and
    $egressSecretVaultSource.Contains('formatVersion != 2') -and
    $egressSecretVaultSource.Contains('recordVersion < 1')) 'Egress exact-request policy pins the unopened DPAPI v2 credential record without creating a circular destination-scope hash and verifies it before ephemeral unprotect'
Assert-Static ($egressSupervisorEngineSource.Contains('claims.ExecutionMode') -and
    $egressSupervisorEngineSource.Contains('ActionExecutionModes.Execute') -and
    $egressSupervisorEngineSource.Contains('budgets.BrokerMaxDeliverySessions') -and
    $egressSupervisorEngineSource.Contains('budgets.BrokerMaxRequestAttemptsPerSession') -and
    $egressSupervisorEngineSource.Contains('budgets.BrokerSerializedResultUpperBoundBytes') -and
    $egressSupervisorEngineSource.Contains('budgets.MaxExternalEgressBytes - brokerReservation') -and
    $egressSupervisorEngineSource.Contains('binding.ReservedCapabilityEgressBytes != expectedCapabilityEgressBytes') -and
    $egressHostPostureSource.Contains('OpenAndBindMappedImage') -and
    $egressHostPostureSource.Contains('ProcessImageFileMapping') -and
    $egressHostPostureSource.Contains('GenericRead | FileExecute | Synchronize')) 'Egress source retains execute-only authorization, deterministic broker-residual binding, and mapped supervisor self-image checks without treating static presence as deployment proof'
Assert-Static ($aclHardenerSource.Contains('@"supervisor\privileged-command-supervisor\lifecycle.v1.jsonl.lock"') -and
    $privilegedCommandLifecycleStoreSource.Contains('requirePreprovisionedFiles ? FileMode.Open : FileMode.OpenOrCreate') -and
    $privilegedCommandLifecycleStoreSource.Contains('FileShare.None') -and
    $privilegedCommandLifecycleStoreSource.Contains('ValidateFileHandle(_ownershipLock.SafeFileHandle') -and
    $privilegedCommandLifecycleStoreSource.Contains('protection?.ValidateOpened(') -and
    $privilegedCommandJournalProtectionSource.Contains('ControlFlags.DiscretionaryAclProtected') -and
    $privilegedCommandJournalProtectionSource.Contains('SupervisorServiceIdentity.RequiredServiceSid') -and
    $privilegedCommandJournalProtectionSource.Contains('FileSystemRights.FullControl') -and
    $privilegedCommandJournalProtectionSource.Contains('FileSystemRights.Modify') -and
    $privilegedCommandJournalProtectionSource.Contains('FileSystemRights.ReadAndExecute')) 'Privileged-command runtime requires both installer-precreated lifecycle files and the shared exact owner/DACL/final-path contract'
Assert-Static ($privilegedCommandProgramSource.Contains('PinnedActionTokenVerificationKeyResolver') -and
    $privilegedCommandOptionsSource.Contains('"Itemba.Msaidizi.PrivilegedCommandIsolation.v2"') -and
    $privilegedCommandProgramSource.Contains('Es256ActionTokenVerifier') -and
    $privilegedCommandEngineSource.Contains('_actionTokenVerifier.VerifyAsync(') -and
    $privilegedCommandEngineSource.Contains('PayloadDigest.Sha256Hex(compactActionToken)') -and
    $privilegedCommandVerificationKeysSource.Contains('StoreName.TrustedPeople, StoreLocation.LocalMachine') -and
    $privilegedCommandVerificationKeysSource.Contains('matches.Count != 1 || matches[0].HasPrivateKey') -and
    $privilegedCommandVerificationKeysSource.Contains('CryptographicOperations.FixedTimeEquals(')) 'Isolation supervisor independently verifies the compact action token through one exact public-only TrustedPeople P-256 pin'
$isolationAuthorizationRecord = [regex]::Match(
    $privilegedCommandContractsSource,
    '(?s)public sealed record PrivilegedCommandIsolationActionAuthorizationV2\(.*?\);')
$isolationPersistedBindingRecord = [regex]::Match(
    $privilegedCommandContractsSource,
    '(?s)public sealed record PrivilegedCommandIsolationActionBinding\(.*?\);')
Assert-Static ($isolationAuthorizationRecord.Success -and
    $isolationAuthorizationRecord.Value.Contains('string ArgumentsSha256') -and
    $isolationAuthorizationRecord.Value.Contains('string IdempotencyKeySha256') -and
    -not $isolationAuthorizationRecord.Value.Contains('string IdempotencyKey,') -and
    $isolationPersistedBindingRecord.Success -and
    $isolationPersistedBindingRecord.Value.Contains('string ActionTokenSha256') -and
    $isolationPersistedBindingRecord.Value.Contains('string InvocationSha256') -and
    -not $isolationPersistedBindingRecord.Value.Contains('CompactActionToken') -and
    -not $isolationPersistedBindingRecord.Value.Contains('Arguments') -and
    -not $isolationPersistedBindingRecord.Value.Contains('Environment') -and
    $privilegedCommandEngineSource.Contains('PayloadDigest.Sha256Hex(actionRequest.IdempotencyKey)') -and
    $privilegedCommandEngineSource.Contains('PayloadDigest.Sha256Hex(compactActionToken)')) 'Isolation persistence binds argument, token, invocation, and idempotency digests without raw authorization material'
Assert-Static ($privilegedCommandProgramSource.Contains('PinnedDriverAttestationVerificationKeyResolver') -and
    $privilegedCommandDriverClientSource.Contains('SignedDriverAttestationValidator.Validate(') -and
    $privilegedCommandDriverClientSource.Contains('PrivilegedCommandIsolationSignaturePurposes.DriverAttestation') -and
    $privilegedCommandDriverAttestationValidatorSource.Contains('PrivilegedCommandIsolationCanonical.VerifyDriverAttestation(') -and
    $privilegedCommandDriverAttestationValidatorSource.Contains('evidence.ChallengeNonceSha256') -and
    $privilegedCommandDriverAttestationValidatorSource.Contains('options.DriverAttestationMaximumLifetime') -and
    $privilegedCommandDriverClientSource.Contains('evidence.WdacEnforced') -and
    $privilegedCommandHostPostureSource.Contains('ProbeSecureBoot()') -and
    $privilegedCommandHostPostureSource.Contains('HvciEnforced(codeIntegrity)') -and
    $privilegedCommandHostPostureSource.Contains('WdacEnforced(codeIntegrity)')) 'Isolation source requires a fresh signed nonce-bound driver attestation and independent Secure Boot, HVCI, and WDAC host posture checks without claiming live deployment proof'
foreach ($safeConfigName in @('service', 'agent', 'update', 'recovery', 'audit-signer', 'egress-supervisor', 'privileged-command-supervisor')) {
    Assert-Static ($hardeningProjectSource -match [regex]::Escape("Itemba.Msaidizi.InstallerDefaults.$safeConfigName.appsettings.json")) "Signed hardening helper embeds the $safeConfigName safe configuration baseline"
}
Assert-Static ($aclHardenerSource -match 'ConfigurationTrustMode\.TrustedMarkedInstall => exact' -and $aclHardenerSource -match 'ConfigurationTrustMode\.TrustedLegacyInstall => exact' -and $aclHardenerSource -match 'HasOnlyAllowlistedAccess' -and $aclHardenerSource -match 'HasUntrustedMutationAuthority' -and $aclHardenerSource -match 'OpenSingleLinkFile\(config\)' -and $aclHardenerSource -match 'OpenSingleLinkFile\(path\)') 'Repair preserves only provenance-backed exact ACLs (or constrained legacy ACLs) and handle-locks config/replay files through validation'
Assert-Static ($hardeningProgramSource.IndexOf('aclHardener.Apply();', [StringComparison]::Ordinal) -lt $hardeningProgramSource.IndexOf('ServiceDaclHardener.Apply', [StringComparison]::Ordinal) -and $hardeningProgramSource.IndexOf('ServiceDaclHardener.Apply', [StringComparison]::Ordinal) -lt $hardeningProgramSource.IndexOf('FirewallBlockManager.Install', [StringComparison]::Ordinal) -and $hardeningProgramSource.IndexOf('FirewallBlockManager.Install', [StringComparison]::Ordinal) -lt $hardeningProgramSource.IndexOf('aclHardener.CommitConfigurationProvenance();', [StringComparison]::Ordinal)) 'Provenance marker commits only after ACL, service-DACL, and firewall hardening succeed'
Assert-Static ($hardeningSources -match 'RemoveOnlyExact') 'Helper firewall cleanup matches exact rule names and executable paths'

$providerVerifierRoot = Join-Path $installerRoot 'src\Itemba.Msaidizi.ProviderContractVerifier'
$providerVerifierSources = (Get-ChildItem -LiteralPath $providerVerifierRoot -File -Filter '*.cs' | Get-Content -Raw) -join "`n"
Assert-Static ($providerVerifierSources -match 'DSASignatureFormat\.IeeeP1363FixedFieldConcatenation' -and $providerVerifierSources -match 'SignatureDomain') 'Provider-contract verifier enforces domain-separated P1363 ES256'
Assert-Static ($providerVerifierSources -match 'https://api\.anthropic\.com' -and $providerVerifierSources -match 'urn:sha256:' -and $providerVerifierSources -match 'providerRetentionSeconds') 'Provider-contract verifier pins origin, content-addressed legal reference, and zero retention'
Assert-Static ($providerVerifierSources -match 'RequiredWindowStartUtc' -and $providerVerifierSources -match 'RequiredWindowEndUtc' -and $providerVerifierSources -match 'PROVIDER_CONTRACT_WINDOW_NOT_COVERED') 'Provider-contract verifier covers the complete operational and ring window'
Assert-Static ($providerVerifierSources -match 'MaximumAttestationBytes\s*=\s*64\s*\*\s*1024' -and
    $providerVerifierSources -match 'NumberOfLinks != 1' -and
    $providerVerifierSources -match 'RequireDistinctFileIdentities' -and
    $providerVerifierSources -match 'FileShare\.Read') 'Provider verifier matches backend size ceiling and locks distinct single-link input identities'
Assert-Static ($providerVerifierSources -notmatch 'ExportPkcs8PrivateKey|ExportECPrivateKey|SignData\(') 'Production provider-contract verifier contains no signing or private-key export path'

$candidateScript = Get-Content -LiteralPath (Join-Path $installerRoot 'scripts\New-SignedReleaseCandidate.ps1') -Raw -Encoding utf8
$approvalScript = Get-Content -LiteralPath (Join-Path $installerRoot 'scripts\Approve-SignedRelease.ps1') -Raw -Encoding utf8
$operationalApprovalScript = Get-Content -LiteralPath (Join-Path $installerRoot 'scripts\Approve-OperationalRelease.ps1') -Raw -Encoding utf8
$commonScript = Get-Content -LiteralPath (Join-Path $installerRoot 'scripts\Release.Common.psm1') -Raw -Encoding utf8
$pathPolicyTest = Get-Content -LiteralPath (Join-Path $installerRoot 'scripts\Test-ReleasePathPolicy.ps1') -Raw -Encoding utf8
$vmScript = Get-Content -LiteralPath (Join-Path $installerRoot 'vm\Invoke-MsaidiziVmAcceptance.ps1') -Raw -Encoding utf8
$allPipelineText = $candidateScript + $approvalScript + $operationalApprovalScript + $vmScript
Assert-Static ($allPipelineText -notmatch '(?i)\bSkip(Sign|Scan|Sbom|Vm|Verify|Test|Audit)\b') 'Release/VM pipeline exposes no skip gate'
foreach ($required in @(
    'Assert-TrustedPipelineScript', 'Assert-MicrosoftSignedTool', 'Protect-UnsignedStagedArtifacts',
    'MSAIDIZI_WIX7_EULA_ACCEPTED_BY_AUTHORIZED_ORG', 'MSAIDIZI_WIX7_OSMF_COMPLIANCE_REFERENCE',
    'RestoreLockedMode=true', 'NuGet vulnerability scan', 'Microsoft Defender final candidate scan',
    'generate SPDX SBOM', 'validate SPDX SBOM', 'wix-msi-validation.txt',
    'schema-and-stock-ice-validation=PASS', 'AWAITING_SIGNED_DISPOSABLE_VM_ACCEPTANCE'
)) {
    Assert-Static ($candidateScript.Contains($required)) "Candidate fail-closed gate present: $required"
}
foreach ($supportArtifact in @(
    'operational\README.md',
    'operational\operational-acceptance.schema.json',
    'operational\ring-acceptance.schema.json'
)) {
    Assert-Static ($candidateScript.Contains($supportArtifact)) "Signed candidate stages operational contract: $supportArtifact"
}
Assert-Static ($candidateScript -match 'provider-contract-verifier\.packages\.lock\.json' -and
    $candidateScript -match 'reproducible publish provider-contract verifier' -and
    $candidateScript -match "supportRoot\.FullName 'ProviderContractVerifier'") 'Signed candidate stages the locked read-only provider-contract verifier'
foreach ($supervisorProject in @('Msaidizi.EgressSupervisor', 'Msaidizi.PrivilegedCommandSupervisor')) {
    Assert-Static ($candidateScript.Contains("$supervisorProject.packages.lock.json") -and
        $candidateScript.Contains("src\$supervisorProject\$supervisorProject.csproj")) "Signed candidate requires a dedicated lock and publishes $supervisorProject"
}
Assert-Static ($candidateScript -match '-p:AcceptEula=wix7' -and $candidateScript -match 'authorized organization representative') 'WiX acceptance is passed only after explicit authorized attestation'
Assert-Static ($candidateScript -match 'Assert-MicrosoftSignedTool -Path \$DotNetPath' -and $candidateScript -match 'actualDotNetHostSha256' -and $candidateScript -match 'Assert-AuthenticatedToolHash' -and $candidateScript -match 'policy\.dotnetHostSha256') '.NET host requires Microsoft Authenticode trust and authenticated-policy SHA-256'
Assert-Static ($candidateScript -match 'Assert-AuthenticatedToolHash' -and $candidateScript -match 'policy\.sbomToolSha256' -and $commonScript -match 'Caller-controlled \$Description hash substitution') 'SBOM tool hash is pinned by authenticated policy, not selected by caller'
$protectedVerificationPath = Join-Path $companionRoot 'scripts\Invoke-ProtectedSourceVerification.ps1'
$protectedVerificationScript = Get-Content -LiteralPath $protectedVerificationPath -Raw -Encoding utf8
$companionStaticPath = Join-Path $companionRoot 'scripts\verify-static.ps1'
$companionStaticScript = Get-Content -LiteralPath $companionStaticPath -Raw -Encoding utf8
$ciWorkflowPath = Join-Path $repositoryRoot '.github\workflows\ci.yml'
$ciWorkflow = Get-Content -LiteralPath $ciWorkflowPath -Raw -Encoding utf8
$deployWorkflowPath = Join-Path $repositoryRoot '.github\workflows\deploy-production.yml'
$deployWorkflow = Get-Content -LiteralPath $deployWorkflowPath -Raw -Encoding utf8
$gitAttributes = Get-Content -LiteralPath (Join-Path $repositoryRoot '.gitattributes') -Raw -Encoding utf8
$embeddedVerificationHash = [regex]::Match(
    $candidateScript,
    '\$embeddedProtectedSourceVerificationSha256\s*=\s*''([0-9A-F]{64})''')
$actualVerificationHash = (Get-FileHash -LiteralPath $protectedVerificationPath -Algorithm SHA256).Hash
Assert-Static ($embeddedVerificationHash.Success -and
    $embeddedVerificationHash.Groups[1].Value -ceq $actualVerificationHash) 'Signed candidate entry pins the exact protected source-verification runner bytes'
foreach ($required in @(
    'restore Windows companion solution', 'verify Windows companion formatting',
    'build Windows companion solution', 'test Windows companion solution',
    'restore installer hardening tests from lock files', 'verify installer hardening formatting',
    'build installer hardening tests', 'test installer hardening boundary', '--locked-mode',
    '--verify-no-changes', '--no-build', '--no-restore',
    'verify companion security boundaries', 'verify installer and release authoring',
    'verify release bootstrap policy dynamically', 'verify release path policy dynamically',
    'verify release tool trust policy dynamically', 'verify operational evidence policy dynamically',
    'verify production prerequisite inventory dynamically',
    'verify native network-isolation protocol and source contract'
)) {
    Assert-Static ($protectedVerificationScript.Contains($required)) "Protected source gate contains: $required"
}
Assert-Static ($protectedVerificationScript -match '-RequireRoslyn' -and
    $companionStaticScript -match '\[switch\]\$RequireRoslyn' -and
    $companionStaticScript -match 'protected verification may not skip C# syntax parsing') 'Protected source gate requires Roslyn instead of accepting the fallback skip path'
Assert-Static ($protectedVerificationScript -match 'elseif \(\$PassDotNetPath\)' -and
    $protectedVerificationScript -match '& \$resolvedPath -DotNetPath \$dotnet' -and
    $protectedVerificationScript -match '(?s)operationalEvidencePolicySha256.+-PassDotNetPath') 'Operational evidence harness receives the exact SDK host already validated by the protected runner'
Assert-Static ($protectedVerificationScript -match "PSEdition -cne 'Core'" -and
    $protectedVerificationScript -match 'PSVersion\.Major -ne 7' -and
    $protectedVerificationScript -match 'PSVersion\.Minor -lt 4' -and
    $candidateScript -match 'Signed release construction requires PowerShell Core 7\.4') 'Protected verification and signed candidate fail closed outside PowerShell Core 7.4+ 7.x'
Assert-Static ($protectedVerificationScript -match 'FileShare\]::Read' -and
    $protectedVerificationScript -match 'ComputeHash\(\$readLock\)' -and
    $protectedVerificationScript -match 'bytes do not match the protected verification runner') 'Protected source gate locks and hashes every downstream PowerShell verifier'
foreach ($hashPinnedPath in @(
    'windows-companion/scripts/Invoke-ProtectedSourceVerification.ps1',
    'windows-companion/scripts/verify-static.ps1',
    'windows-companion/installer/scripts/Test-InstallerStatic.ps1',
    'windows-companion/installer/scripts/Test-ReleaseBootstrapPolicy.ps1',
    'windows-companion/installer/scripts/Test-ReleasePathPolicy.ps1',
    'windows-companion/installer/scripts/Test-ReleaseToolTrustPolicy.ps1',
    'windows-companion/installer/scripts/Test-OperationalEvidencePolicy.ps1',
    'windows-companion/installer/scripts/Test-ProductionPrerequisites.ps1',
    'windows-companion/installer/scripts/Test-ProductionPrerequisiteInventory.ps1',
    'windows-companion/native/Msaidizi.NetworkIsolationDriver/tests/verify-protocol.ps1'
)) {
    $attributePattern = '(?m)^' + [regex]::Escape($hashPinnedPath) + ' text eol=lf\s*$'
    Assert-Static ($gitAttributes -match $attributePattern) "Hash-pinned script has checkout-stable LF bytes: $hashPinnedPath"
}
$downstreamHashPins = @(
    [pscustomobject]@{ Variable = 'companionStaticSha256'; Path = $companionStaticPath },
    [pscustomobject]@{ Variable = 'installerStaticSha256'; Path = Join-Path $installerRoot 'scripts\Test-InstallerStatic.ps1' },
    [pscustomobject]@{ Variable = 'releaseBootstrapPolicySha256'; Path = Join-Path $installerRoot 'scripts\Test-ReleaseBootstrapPolicy.ps1' },
    [pscustomobject]@{ Variable = 'releasePathPolicySha256'; Path = Join-Path $installerRoot 'scripts\Test-ReleasePathPolicy.ps1' },
    [pscustomobject]@{ Variable = 'releaseToolTrustPolicySha256'; Path = Join-Path $installerRoot 'scripts\Test-ReleaseToolTrustPolicy.ps1' },
    [pscustomobject]@{ Variable = 'operationalEvidencePolicySha256'; Path = Join-Path $installerRoot 'scripts\Test-OperationalEvidencePolicy.ps1' },
    [pscustomobject]@{ Variable = 'productionPrerequisiteInventoryPolicySha256'; Path = Join-Path $installerRoot 'scripts\Test-ProductionPrerequisiteInventory.ps1' },
    [pscustomobject]@{ Variable = 'networkIsolationProtocolSha256'; Path = Join-Path $companionRoot 'native\Msaidizi.NetworkIsolationDriver\tests\verify-protocol.ps1' }
)
foreach ($hashPin in $downstreamHashPins) {
    $pinMatch = [regex]::Match(
        $protectedVerificationScript,
        '\$' + [regex]::Escape($hashPin.Variable) + '\s*=\s*''([0-9A-F]{64})''')
    $actualHash = (Get-FileHash -LiteralPath $hashPin.Path -Algorithm SHA256).Hash
    Assert-Static ($pinMatch.Success -and $pinMatch.Groups[1].Value -ceq $actualHash) "Protected runner pins exact bytes: $($hashPin.Variable)"
}
$productionPrerequisiteInventoryPath = Join-Path $installerRoot 'scripts\Test-ProductionPrerequisites.ps1'
$productionPrerequisiteInventoryTestPath = Join-Path $installerRoot 'scripts\Test-ProductionPrerequisiteInventory.ps1'
$productionPrerequisiteInventoryScript = Get-Content -LiteralPath $productionPrerequisiteInventoryPath -Raw -Encoding utf8
$productionPrerequisiteInventoryTest = Get-Content -LiteralPath $productionPrerequisiteInventoryTestPath -Raw -Encoding utf8
$embeddedInventoryHash = [regex]::Match(
    $productionPrerequisiteInventoryTest,
    '\$expectedInventorySha256\s*=\s*''([0-9A-F]{64})''')
$actualInventoryHash = (Get-FileHash -LiteralPath $productionPrerequisiteInventoryPath -Algorithm SHA256).Hash
Assert-Static ($embeddedInventoryHash.Success -and
    $embeddedInventoryHash.Groups[1].Value -ceq $actualInventoryHash) 'Protected prerequisite harness pins exact inventory bytes'
foreach ($inventoryBoundary in @(
    "authority = 'NON_AUTHORITATIVE_READ_ONLY_INVENTORY'",
    'productionDeploymentEligible = $false',
    'egress_source_components_present_not_deployment_proof',
    'isolation_client_and_fail_closed_fallback_present_not_deployment_proof',
    'SignedCms',
    'kernelOrWfpEnforcementActive',
    'supervisorOwnedDataPathConsumed',
    'destinationPolicySha256',
    'trustedRootKillSwitchEnforced',
    'exactRequestPolicyEnforced',
    'credentialRecordSha256Bound',
    'credentialVaultSupervisorReadOnly',
    'supervisorOwnedTlsAndSocket',
    'restrictedServicePeerVerifiedBeforeTokenWrite',
    'processCreationIdentityBoundAcrossFlow',
    'executeOnlyAuthorizationVerified',
    'exactBrokerResidualVerified',
    'mappedSupervisorSelfImageVerified',
    'executeOnlyAuthorizationNegativeControlResultSha256',
    'brokerResidualNegativeControlsResultSha256',
    'mappedSupervisorSelfImageNegativeControlResultSha256',
    'attestationSpkiSha256',
    'receiptSpkiSha256',
    'nativeEnforcementActive',
    'supervisorProcessDenyActive',
    'reservationLeaseKeyId',
    'terminalEnforcementReceiptSpkiSha256',
    'actionTokenVerificationKeyId',
    'driverAttestationVerificationKeyId',
    'supervisorServiceImageSha256',
    'driverImageSha256',
    'isolationPolicySha256',
    'driverPolicyEpoch',
    'actionTokenIndependentlyVerified',
    'verificationCertificatesPublicOnly',
    'signedDriverAttestationVerified',
    'driverAttestationNonceBound',
    'driverAttestationSigningKeyHardwareBacked',
    'secureBootVerified',
    'hvciVerified',
    'wdacVerified',
    'exactInvocationBoundToSignedArguments',
    'suspendedProcessImageIdentityBound',
    'liveDriverServiceAndLoadedImageVerified',
    'driverDeviceHandleBoundToSignedAttestation',
    'protocolVersion',
    'supervisorServiceSid',
    'actionTokenExpectedIssuer',
    'actionTokenExpectedAudience',
    'actionTokenExpectedSubject',
    'maximumInvocationTimeoutSeconds',
    'maximumInvocationOutputBytes',
    'maximumInvocationProcesses',
    'maximumInvocationProcessMemoryBytes',
    'driverAttestationBootBound',
    'exactSuspendedInvocationMeasurementBound',
    'mappedProcessImageIdentityBound',
    'isolationJournalSha256',
    'authorizationPersistenceVerificationResultSha256',
    'authorizationMaterialDigestOnlyPersistenceVerified',
    '$claim.vmEvidence.runId',
    'vmRunBoundToSignedInstallerAcceptance',
    'signed_installer_vm_approval_verified',
    'deployment_evidence_vm_run_not_bound_to_signed_installer_acceptance',
    'companionPurposePinsMatched',
    'serviceOnlyCngKeyDaclsExact',
    'signed_live_deployment_evidence_verified',
    "validationLevel = 'presence_and_digest_only'",
    'if (-not $inputSetComplete) { exit 2 }'
)) {
    Assert-Static ($productionPrerequisiteInventoryScript.Contains($inventoryBoundary)) "Production prerequisite inventory boundary present: $inventoryBoundary"
}
Assert-Static (-not $productionPrerequisiteInventoryScript.Contains('$_.Exception.Message') -and
    -not $productionPrerequisiteInventoryScript.Contains('Write-Host')) 'Production prerequisite JSON cannot leak exception paths or mix host output'
$sourceGateIndex = $candidateScript.IndexOf('& $sourceVerificationScript -DotNetPath $dotnet', [StringComparison]::Ordinal)
$candidateCreationIndex = $candidateScript.IndexOf('$candidatePath = Assert-SafeNewDirectoryPath', [StringComparison]::Ordinal)
Assert-Static ($sourceGateIndex -ge 0 -and $candidateCreationIndex -gt $sourceGateIndex) 'Signed candidate runs protected source verification before creating an artifact directory'
Assert-Static ($candidateScript -match 'sourceVerificationReadLock\s*=\s*\[IO\.File\]::Open' -and
    $candidateScript -match 'actualSourceVerificationSha256' -and
    $candidateScript -match 'postVerificationDirty') 'Signed candidate locks the pinned runner and rejects verification-time source changes'
$ciWindowsJob = [regex]::Match(
    $ciWorkflow,
    '(?ms)^  windows-companion-verify:\r?\n(?<body>.*?)(?=^  [a-z0-9][a-z0-9-]*:\r?$|\z)')
Assert-Static ($ciWindowsJob.Success -and
    $ciWindowsJob.Groups['body'].Value -match 'runs-on: windows-2022' -and
    $ciWindowsJob.Groups['body'].Value -match "dotnet-version: '8\.0\.400'" -and
    $ciWindowsJob.Groups['body'].Value -match 'Invoke-ProtectedSourceVerification\.ps1 -DotNetPath \$dotnet') 'CI runs the protected source gate on pinned Windows 2022 and .NET 8.0.400'
$runtimeSmokeJob = [regex]::Match(
    $ciWorkflow,
    '(?ms)^  deployment-runtime-smoke:\r?\n(?<body>.*?)(?=^  [a-z0-9][a-z0-9-]*:\r?$|\z)')
Assert-Static ($runtimeSmokeJob.Success -and
    $runtimeSmokeJob.Groups['body'].Value -match '(?m)^      - windows-companion-verify\s*$') 'Main deployment smoke and image path depend on the Windows companion gate'
$deployCiGate = [regex]::Match(
    $deployWorkflow,
    '(?ms)^      - name: Require CI to have passed for this exact commit\r?\n(?<body>.*?)(?=^      - name:|\z)')
$deployCiGateBody = if ($deployCiGate.Success) { $deployCiGate.Groups['body'].Value } else { '' }
Assert-Static ($deployCiGate.Success -and
    $deployCiGateBody.Contains('--workflow ''ITEMBA-R CI''') -and
    $deployCiGateBody.Contains('--event push') -and
    $deployCiGateBody.Contains('--branch main') -and
    $deployCiGateBody.Contains('--status success') -and
    $deployCiGateBody.Contains('--commit "$SHA"')) 'Production deploy queries only successful ITEMBA-R CI push runs on main for the exact SHA'
foreach ($exactRunBinding in @(
    '[ "$EVENT" != "push" ]', '[ "$HEAD_BRANCH" != "main" ]',
    '[ "$HEAD_SHA" != "$SHA" ]', '[ "$STATUS" != "completed" ]',
    '[ "$CONCLUSION" != "success" ]', '[ -z "$RUN_ID" ]'
)) {
    Assert-Static ($deployCiGateBody.Contains($exactRunBinding)) "Production deploy revalidates CI run field: $exactRunBinding"
}
foreach ($required in @(
    'PASS_PENDING_EXTERNAL_VM_DISPOSITION', 'ExpectedVmOrchestratorSignerThumbprint',
    'REVERTED_TO_APPROVED_CLEAN_SNAPSHOT', 'DESTROYED', 'INSTALLER_VM_ACCEPTED_AWAITING_OPERATIONAL_COMPANION_ACCEPTANCE',
    'vmDispositionExternallyAttested', 'noSkippedChecks'
)) {
    Assert-Static ($approvalScript.Contains($required)) "Approval evidence gate present: $required"
}
foreach ($checkId in @(
    'candidate.integrity', 'candidate.authenticode', 'vm.prerequisites', 'services.install-state',
    'configuration.fail-closed', 'agent.standard-integrity', 'acl.trust-separation',
    'network.inbound-blocked', 'runtime.no-listener', 'uninstall.preservation'
)) {
    Assert-Static ($vmScript.Contains($checkId)) "VM acceptance case present: $checkId"
}
Assert-Static ($vmScript -match 'HypervisorPresent' -and $vmScript -match 'TpmReady' -and $vmScript -match 'SpecVersion' -and $vmScript -match 'NTFS') 'VM prerequisites are explicitly verified'
Assert-Static ($vmScript -match 'Get-NetTCPConnection' -and $vmScript -match 'Get-NetUDPEndpoint') 'VM proves the service opens no listener'
Assert-Static ($vmScript -match 'supervisor\\egress-boundary' -and $vmScript -match 'egressReceiptReplayLock' -and $vmScript -match 'Main service cannot append the installer-owned egress receipt ledger' -and $vmScript -match 'Recovery operators can mutate the egress receipt replay ledger') 'VM proves the dedicated egress replay ledger and ownership lock have least-privilege ACLs'
Assert-Static ($vmScript -match 'Itemba Msaidizi Egress Supervisor' -and
    $vmScript -match 'Itemba Msaidizi Privileged Command Supervisor' -and
    $vmScript -match 'automatic-nondelayed' -and
    $vmScript -match 'All six exact service accounts') 'VM inventories all six services and exact enforcement-supervisor start semantics'
Assert-Static ($vmScript -match 'config\\egress-supervisor\\appsettings\.json' -and
    $vmScript -match 'config\\privileged-command-supervisor\\appsettings\.json' -and
    $vmScript -match 'All seven configs') 'VM inventories all seven preserved fail-closed configurations'
Assert-Static ($vmScript -match 'egressSupervisorJournalLock' -and
    $vmScript -match 'privilegedCommandSupervisorJournal' -and
    $vmScript -match 'privilegedCommandSupervisorJournalLock' -and
    $vmScript -match 'can mutate autonomous-update payloads' -and
    $vmScript -match 'companion-owned replay ledger') 'VM proves supervisor-owned journal ACLs and denies cross-write to companion replay and autonomous update state'
Assert-Static ($vmScript -match 'Invoke-Msi -Operation uninstall' -and $vmScript -match 'postUninstallProbe') 'VM proves uninstall preservation'
Assert-Static ($vmScript -match "evidenceScope = 'MSI_INSTALL_FAIL_CLOSED_BOOTSTRAP_AND_UNINSTALL_ONLY'" -and $vmScript -match 'operationalCoverage = \[ordered\]' -and $vmScript -match "status = 'NOT_EXECUTED'") 'VM evidence explicitly excludes operational companion acceptance'
Assert-Static ($approvalScript -match 'productionDeploymentEligible = \$false' -and $approvalScript -match "operationalCompanionAcceptance = 'NOT_EXECUTED'" -and $approvalScript -match "productionRingAcceptance = 'NOT_EXECUTED'") 'Installer acceptance cannot be interpreted as production operational approval'
foreach ($required in @(
    'PASS_AWAITING_RING_ACCEPTANCE', 'FULL_COMPANION_OPERATIONAL_ACCEPTANCE',
    'provider-zero-training-and-zero-retention-contract',
    'external-egress-boundary-browser-and-raw-shell',
    'voice-vision-text-governance-parity', 'RING_0', 'RING_5', 'RING_25', 'RING_100',
    'minimumRingHealthHours', 'allFailureCountersZero', 'immutableArtifactsBound',
    'ProviderContractAttestationPath', 'ProviderContractPublicKeyPath',
    'ProviderContractDocumentPath', 'providerContractCryptographicallyVerified',
    'providerContractCoversOperationalAndRingWindow',
    'PRODUCTION_OPERATIONAL_AND_RING_ACCEPTED'
)) {
    Assert-Static ($operationalApprovalScript.Contains($required)) "Operational/ring evidence gate present: $required"
}
Assert-Static ($operationalApprovalScript -match 'allowedOperationalEvidenceSignerThumbprints' -and $operationalApprovalScript -match 'allowedRingEvidenceSignerThumbprints' -and $operationalApprovalScript -match 'identities must be distinct') 'Operational and ring evidence use distinct protected-policy signers'
Assert-Static ($operationalApprovalScript -match 'providerVerifierReadLock\s*=\s*\[IO\.File\]::Open' -and
    $operationalApprovalScript -match 'lockedProviderVerifierSha256' -and
    $operationalApprovalScript -match 'signed release manifest') 'Provider verifier bytes are manifest-verified and write/delete locked through execution'
Assert-Static ($operationalApprovalScript -match 'Refusing to overwrite an existing production acceptance record' -and $operationalApprovalScript -notmatch '(?i)\bSkip(Sign|Verify|Test|Audit|Operational|Ring)\b') 'Production promotion is append-only and exposes no skip switch'

$policyHash = (Get-FileHash -LiteralPath (Join-Path $installerRoot 'release-policy.json') -Algorithm SHA256).Hash
foreach ($entryScript in @(
    [pscustomobject]@{ Name = 'candidate'; Text = $candidateScript },
    [pscustomobject]@{ Name = 'approval'; Text = $approvalScript },
    [pscustomobject]@{ Name = 'operational approval'; Text = $operationalApprovalScript }
)) {
    $embeddedHashMatch = [regex]::Match($entryScript.Text, '\$embeddedReleasePolicySha256\s*=\s*''([0-9A-F]{64})''')
    Assert-Static ($embeddedHashMatch.Success -and $embeddedHashMatch.Groups[1].Value -ceq $policyHash) "$($entryScript.Name) entry script embeds the exact release-policy SHA-256"
    $hashCheckIndex = $entryScript.Text.IndexOf('actualReleasePolicySha256 -cne $embeddedReleasePolicySha256', [StringComparison]::Ordinal)
    $policyParseIndex = $entryScript.Text.IndexOf('Microsoft.PowerShell.Utility\ConvertFrom-Json', [StringComparison]::Ordinal)
    $signatureIndex = $entryScript.Text.IndexOf('$moduleSignature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature', [StringComparison]::Ordinal)
    $importIndex = $entryScript.Text.IndexOf('Microsoft.PowerShell.Core\Import-Module', [StringComparison]::Ordinal)
    Assert-Static ($hashCheckIndex -ge 0 -and $hashCheckIndex -lt $policyParseIndex) "$($entryScript.Name) authenticates policy bytes before parsing/trusting fields"
    Assert-Static ($signatureIndex -ge 0 -and $signatureIndex -lt $importIndex) "$($entryScript.Name) authenticates Release.Common before Import-Module"
    Assert-Static ($entryScript.Text -match '\$moduleReadLock\s*=\s*\[IO\.File\]::Open' -and $entryScript.Text -match '\[IO\.FileShare\]::Read' -and $importIndex -lt $entryScript.Text.IndexOf('$moduleReadLock.Dispose()', [StringComparison]::Ordinal)) "$($entryScript.Name) holds a non-write/non-delete module handle through import"
    Assert-Static ($entryScript.Text -match 'SignatureStatus\]::Valid' -and $entryScript.Text -match 'TimeStamperCertificate' -and $entryScript.Text -match 'SignerCertificate\.Thumbprint' -and $entryScript.Text -match 'embeddedPipelineSignerThumbprint') "$($entryScript.Name) rejects unsigned, tampered, untimestamped, and wrong-signer module states"
    Assert-Static ($entryScript.Text -match 'pinnedPipelineSigner -cne \$embeddedPipelineSignerThumbprint') "$($entryScript.Name) rejects a substituted signer in release-policy"
    Assert-Static ($entryScript.Text -match 'trusted CI bootstrap, WDAC policy, or equivalent external' -and $entryScript.Text -match 'cannot (make|establish trust)') "$($entryScript.Name) documents the external entry-script trust boundary"
}

function Test-BootstrapSignatureDecision {
    param([string]$Status, [bool]$HasSigner, [bool]$HasTimestamp, [string]$ActualSigner, [string]$EmbeddedSigner)
    return $Status -ceq 'Valid' -and $HasSigner -and $HasTimestamp -and $ActualSigner -ceq $EmbeddedSigner
}
$embeddedFixtureSigner = '1111111111111111111111111111111111111111'
Assert-Static (-not (Test-BootstrapSignatureDecision -Status 'HashMismatch' -HasSigner $true -HasTimestamp $true -ActualSigner $embeddedFixtureSigner -EmbeddedSigner $embeddedFixtureSigner)) 'Bootstrap regression: tampered module is rejected'
Assert-Static (-not (Test-BootstrapSignatureDecision -Status 'NotSigned' -HasSigner $false -HasTimestamp $false -ActualSigner '' -EmbeddedSigner $embeddedFixtureSigner)) 'Bootstrap regression: unsigned module is rejected'
Assert-Static (-not (Test-BootstrapSignatureDecision -Status 'Valid' -HasSigner $true -HasTimestamp $true -ActualSigner ('2' * 40) -EmbeddedSigner $embeddedFixtureSigner)) 'Bootstrap regression: wrong module signer is rejected'
Assert-Static (-not (Test-BootstrapSignatureDecision -Status 'Valid' -HasSigner $true -HasTimestamp $false -ActualSigner $embeddedFixtureSigner -EmbeddedSigner $embeddedFixtureSigner)) 'Bootstrap regression: untimestamped module is rejected'
Assert-Static (Test-BootstrapSignatureDecision -Status 'Valid' -HasSigner $true -HasTimestamp $true -ActualSigner $embeddedFixtureSigner -EmbeddedSigner $embeddedFixtureSigner) 'Bootstrap regression: exact signed/timestamped module state is accepted'
Assert-Static ('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' -cne $embeddedFixtureSigner) 'Bootstrap regression: caller-controlled signer substitution is rejected'
Assert-Static (('B' * 64) -cne $policyHash) 'Bootstrap regression: tampered policy digest is rejected'
Assert-Static ('2222222222222222222222222222222222222222' -cne $embeddedFixtureSigner) 'Bootstrap regression: substituted policy signer is rejected'
Assert-Static (('C' * 64) -cne ('D' * 64)) 'Bootstrap regression: caller-controlled SBOM hash substitution is rejected'

Assert-Static ($commonScript -match 'FileAttributes\]::ReparsePoint' -and $commonScript -match 'contains a reparse-point component') 'Release path resolver rejects reparse points in every existing component'
Assert-Static ($commonScript -match '\$childItem\.Parent\.FullName' -and $commonScript -match 'GetPathRoot\(\$childPath\)' -and $commonScript -match 'exact same-volume direct child') 'Candidate directories require exact resolved parent and volume'
Assert-Static ($commonScript -match 'NumberOfLinks != 1' -and $commonScript -match 'GetFinalPathNameByHandle' -and $commonScript -match 'SetFileInformationByHandle') 'Staged config deletion uses a locked exact-identity single-link handle'
Assert-Static ($candidateScript -notmatch '\bRemove-Item\b' -and $candidateScript -match 'Remove-VerifiedStagedConfiguration' -and $candidateScript -match 'Assert-VerifiedCandidateLayout') 'Release candidate removes only verified staged config and revalidates layout'
foreach ($pathCase in @('OutputRoot junction', 'tool beneath a reparse component', 'different resolved parent', 'multiply-linked staged configuration', 'single-link exact staged configuration')) {
    Assert-Static ($pathPolicyTest.Contains($pathCase)) "Release path-policy regression is present: $pathCase"
}

$dispositionSchema = Get-JsonFile 'vm\vm-disposition.schema.json'
if ($dispositionSchema) {
    Assert-Static ($dispositionSchema.additionalProperties -eq $false) 'VM disposition schema rejects undeclared fields'
    Assert-Static (@($dispositionSchema.required).Count -ge 10) 'VM disposition schema requires complete binding/proof fields'
}
$operationalSchema = Get-JsonFile 'operational\operational-acceptance.schema.json'
if ($operationalSchema) {
    Assert-Static ($operationalSchema.additionalProperties -eq $false) 'Operational evidence schema rejects undeclared top-level fields'
    Assert-Static (@($operationalSchema.properties.checks.items.properties.id.enum).Count -eq 15) 'Operational evidence schema has the exact reviewed check set'
    Assert-Static ($operationalSchema.properties.checks.minItems -eq 15 -and $operationalSchema.properties.checks.maxItems -eq 15) 'Operational evidence schema requires exactly the 15 reviewed checks'
    Assert-Static ($operationalSchema.properties.artifacts.minItems -eq 18) 'Operational evidence schema artifact minimum covers checks, TPM, provider key, and provider document'
    Assert-Static ($operationalSchema.properties.providerContract.additionalProperties -eq $false -and
        @($operationalSchema.properties.providerContract.required).Count -eq 20) 'Operational evidence schema requires the exact strict provider-contract binding'
    Assert-Static ($operationalSchema.properties.providerContract.properties.apiOrigin.const -ceq 'https://api.anthropic.com' -and
        $operationalSchema.properties.providerContract.properties.contract.const -ceq 'msaidizi-provider-contract-attestation/v2' -and
        $operationalSchema.properties.providerContract.properties.apiCredentialKeyId.pattern -ceq '^[A-Za-z0-9._:@/-]+$' -and
        $operationalSchema.properties.providerContract.properties.immutableLegalReference.pattern -ceq '^urn:sha256:[0-9a-f]{64}$') 'Operational evidence schema pins provider API origin and content-addressed legal reference'
    Assert-Static ($operationalSchema.properties.productionDeploymentEligible.const -eq $false) 'Operational evidence alone cannot claim production eligibility'
}
$ringSchema = Get-JsonFile 'operational\ring-acceptance.schema.json'
if ($ringSchema) {
    Assert-Static ($ringSchema.additionalProperties -eq $false) 'Ring evidence schema rejects undeclared top-level fields'
    Assert-Static ($ringSchema.properties.rings.minItems -eq 4 -and $ringSchema.properties.rings.maxItems -eq 4) 'Ring evidence requires exactly four progression records'
    Assert-Static (@($ringSchema.properties.rings.items.properties.checks.items.properties.id.enum).Count -eq 8) 'Every ring uses the exact reviewed drill set'
}

$companionProgramSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.Companion.Service\Program.cs') -Raw -Encoding utf8
$capabilityRegistrySource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.Companion.Service\Capabilities\CapabilityRegistry.cs') -Raw -Encoding utf8
$credentialEphemeralityPolicySource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.Companion.Service\Capabilities\HostCredentialEphemeralityPolicy.cs') -Raw -Encoding utf8
$ephemeralDisclosureContractSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.Companion.Contracts\Security\EphemeralFileDisclosureContracts.cs') -Raw -Encoding utf8
$resultStoreSource = Get-Content -LiteralPath (Join-Path $companionRoot 'src\Msaidizi.Companion.Service\Execution\FileProtectedActionResultStore.cs') -Raw -Encoding utf8
$deviceBrokerSource = Get-Content -LiteralPath (Join-Path $repositoryRoot 'backend\src\modules\msaidizi-devices\msaidizi-devices.service.ts') -Raw -Encoding utf8
$deviceEphemeralityPolicySource = Get-Content -LiteralPath (Join-Path $repositoryRoot 'backend\src\modules\msaidizi-devices\host-file-ephemerality.policy.ts') -Raw -Encoding utf8
$ephemeralDisclosureProtocolSource = Get-Content -LiteralPath (Join-Path $repositoryRoot 'backend\src\modules\msaidizi-devices\ephemeral-file-disclosure.protocol.ts') -Raw -Encoding utf8
$artifactServiceSource = Get-Content -LiteralPath (Join-Path $repositoryRoot 'backend\src\modules\msaidizi-artifacts\msaidizi-artifacts.service.ts') -Raw -Encoding utf8
$adaptiveReasoningSource = Get-Content -LiteralPath (Join-Path $repositoryRoot 'backend\src\modules\msaidizi-task-runtime\msaidizi-adaptive-reasoning.service.ts') -Raw -Encoding utf8
$ephemeralDisclosureDocSource = Get-Content -LiteralPath (Join-Path $companionRoot 'docs\EPHEMERAL-FILE-DISCLOSURE.md') -Raw -Encoding utf8
$hostCapabilityPackSource = Get-Content -LiteralPath (Join-Path $companionRoot 'docs\HOST-CAPABILITY-PACK.md') -Raw -Encoding utf8
$ephemeralReason = 'REASONING_FILE_EPHEMERAL_CHANNEL_NOT_READY'
Assert-Static ($companionProgramSource -notmatch 'FileSystemFileReadCapabilityAdapter' -and
    $companionProgramSource -notmatch 'filesystem\.file\.disclose\.ephemeral') 'Legacy and reserved ephemeral file-content capabilities are absent from the packaged companion adapter set'
Assert-Static ($capabilityRegistrySource -match 'IsForbiddenFileContentCapability' -and
    $credentialEphemeralityPolicySource -match 'EphemeralFileDisclosureCapabilityId' -and
    $credentialEphemeralityPolicySource -match 'LegacyFileReadCapabilityId') 'Companion registry independently rejects both unavailable file-content identities'
Assert-Static (([regex]::Matches($resultStoreSource, 'AssertCredentialEphemeral\(request\);')).Count -eq 3 -and
    $resultStoreSource.Contains($ephemeralReason) -eq $false -and
    $resultStoreSource -match 'HostCredentialEphemeralityPolicy\.ErrorCode') 'DPAPI result store rejects file-content store, load, and delivery replay through the stable policy code'
Assert-Static (([regex]::Matches($deviceBrokerSource, $ephemeralReason)).Count -ge 6 -and
    $deviceBrokerSource -match 'isUnavailableHostFileContentCapability' -and
    $deviceEphemeralityPolicySource -match 'filesystem\.file\.disclose\.ephemeral') 'Broker queue, claim, result, settlement, and observation boundaries reject legacy and reserved file-content actions'
Assert-Static ($ephemeralDisclosureContractSource -match 'EphemeralFileDisclosureExpectedBinding' -and
    $ephemeralDisclosureContractSource -match 'AllowedMimeTypes' -and
    $ephemeralDisclosureContractSource -match 'MaximumBytes' -and
    $ephemeralDisclosureContractSource -match 'CapabilityVersion' -and
    $ephemeralDisclosureContractSource -match 'RejectingEphemeralFileDisclosurePort' -and
    $ephemeralDisclosureContractSource -notmatch 'byte\[\]\s+(Content|File)' -and
    $ephemeralDisclosureContractSource -notmatch '(?m)^\s*(public|internal).*\b(Stream|PipeReader)\b') 'Managed companion exposes only exact metadata and a rejecting ephemeral disclosure port, never a byte transport'
Assert-Static ($ephemeralDisclosureProtocolSource -match 'assertEphemeralFileProviderContract' -and
    $ephemeralDisclosureProtocolSource -match 'providerRetentionSeconds\s*!==\s*0' -and
    $ephemeralDisclosureProtocolSource -match 'zeroTraining\s*!==\s*true' -and
    $ephemeralDisclosureProtocolSource -match 'allowedMimeTypes' -and
    $ephemeralDisclosureProtocolSource -match 'maximumBytes' -and
    $ephemeralDisclosureProtocolSource -match 'capabilityVersion') 'Backend ephemeral metadata exact-binds content limits, capability identity, and the zero-retention provider contract'
Assert-Static ($artifactServiceSource.Contains($ephemeralReason) -and
    $artifactServiceSource -match 'input\.file != null' -and
    $artifactServiceSource -match 'isUnavailableHostFileContentCapability' -and
    $artifactServiceSource -match 'readSettledFileForAdaptiveReasoning') 'Artifact ingress and legacy adaptive reopening fail closed for raw file bytes'
Assert-Static ($adaptiveReasoningSource.Contains($ephemeralReason) -and
    $adaptiveReasoningSource -match 'checkpointInput\.file' -and
    $adaptiveReasoningSource -match 'failWithoutCall') 'Adaptive reasoning settles legacy file checkpoints before a provider call'
Assert-Static ($ephemeralDisclosureDocSource -match 'No WDK, Windows VM, live provider, or deployment evidence is claimed' -and
    $ephemeralDisclosureDocSource -match 'atomic durable metadata ledger' -and
    $hostCapabilityPackSource -notmatch 'Direct file reads are Base64') 'File-content documentation states the precise source blocker and contains no stale availability claim'

$lockRoot = Join-Path $installerRoot 'locks'
$requiredLockNames = @(
    'Msaidizi.Companion.Contracts.packages.lock.json', 'Msaidizi.Companion.Service.packages.lock.json',
    'Msaidizi.Companion.Agent.packages.lock.json', 'Msaidizi.UpdateSupervisor.packages.lock.json',
    'Msaidizi.RecoverySupervisor.packages.lock.json',
    'Msaidizi.AuditSigner.packages.lock.json',
    'Msaidizi.EgressSupervisor.packages.lock.json',
    'Msaidizi.PrivilegedCommandSupervisor.packages.lock.json',
    'provider-contract-verifier.packages.lock.json',
    'hardening-tests.packages.lock.json', 'wix.packages.lock.json'
)
foreach ($lockName in $requiredLockNames) {
    $lockPath = Join-Path $lockRoot $lockName
    $exists = Test-Path -LiteralPath $lockPath -PathType Leaf
    Assert-Static $exists "Committed package lock exists: $lockName"
    if ($exists) {
        try { Get-Content -LiteralPath $lockPath -Raw -Encoding utf8 | ConvertFrom-Json | Out-Null; Assert-Static $true "Package lock parses: $lockName" }
        catch { Assert-Static $false "Package lock parses: $lockName" }
    }
}

if ($failures.Count -gt 0) {
    Write-Error ("Installer static checks failed ($($failures.Count)):`n - " + ($failures -join "`n - "))
    exit 1
}

Write-Host "Installer static checks passed: $($passes.Count) assertions."
Write-Host 'These are authoring checks only; they do not claim Authenticode, OSMF acceptance, MSI compilation, Defender, SBOM, vulnerability, disposable-VM, operational, or rollout-ring evidence.'
