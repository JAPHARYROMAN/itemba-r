[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$CandidatePath,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F-]{36}$')][string]$VmRunId,
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$CleanTemplateId,
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$SnapshotId,
    [Parameter(Mandatory)][ValidateNotNullOrEmpty()][string]$VmProvider,
    [Parameter(Mandatory)][string]$ReleaseSignerThumbprint,
    [Parameter(Mandatory)][string]$EvidenceSigningThumbprint,
    [Parameter(Mandatory)][string]$EvidenceOutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$script:startedAt = [DateTimeOffset]::UtcNow
$script:checks = [Collections.Generic.List[object]]::new()
$checks = $script:checks

function Normalize-Thumbprint {
    param([Parameter(Mandatory)][string]$Thumbprint)
    $normalized = ($Thumbprint -replace '\s', '').ToUpperInvariant()
    if ($normalized -notmatch '^[0-9A-F]{40}$') {
        throw 'Certificate thumbprints must be exactly 40 hexadecimal characters.'
    }
    return $normalized
}

function Resolve-Directory {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Description)
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction Stop
    if (-not $item.PSIsContainer) { throw "$Description must be a directory: $Path" }
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "$Description cannot be a reparse point: $Path"
    }
    return $item.FullName.TrimEnd('\')
}

function Assert-Administrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'VM acceptance must run from an elevated local Administrator token.'
    }
}

function Get-ExactCertificate {
    param([Parameter(Mandatory)][string]$Thumbprint, [switch]$RequirePrivateKey)
    $expected = Normalize-Thumbprint -Thumbprint $Thumbprint
    $matches = @(Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
        Where-Object { ($_.Thumbprint -replace '\s', '').ToUpperInvariant() -eq $expected })
    if ($matches.Count -ne 1) {
        throw "Expected exactly one certificate with thumbprint $expected; found $($matches.Count)."
    }
    $certificate = $matches[0]
    if ($RequirePrivateKey -and -not $certificate.HasPrivateKey) {
        throw "Certificate $expected has no accessible private key."
    }
    $now = [DateTime]::UtcNow
    if ($certificate.NotBefore.ToUniversalTime() -gt $now -or $certificate.NotAfter.ToUniversalTime() -le $now) {
        throw "Certificate $expected is not currently valid."
    }
    $chain = [Security.Cryptography.X509Certificates.X509Chain]::new()
    try {
        $chain.ChainPolicy.RevocationMode = [Security.Cryptography.X509Certificates.X509RevocationMode]::Online
        $chain.ChainPolicy.RevocationFlag = [Security.Cryptography.X509Certificates.X509RevocationFlag]::EntireChain
        $chain.ChainPolicy.UrlRetrievalTimeout = [TimeSpan]::FromSeconds(30)
        if (-not $chain.Build($certificate)) {
            $details = ($chain.ChainStatus | ForEach-Object { "$($_.Status): $($_.StatusInformation.Trim())" }) -join '; '
            throw "Certificate chain validation failed for $expected. $details"
        }
    }
    finally { $chain.Dispose() }
    return $certificate
}

function Assert-DetachedSignature {
    param(
        [Parameter(Mandatory)][string]$ContentPath,
        [Parameter(Mandatory)][string]$SignaturePath,
        [Parameter(Mandatory)][string]$ExpectedThumbprint
    )
    Add-Type -AssemblyName System.Security.Cryptography.Pkcs
    $content = [IO.File]::ReadAllBytes((Get-Item -LiteralPath $ContentPath -Force -ErrorAction Stop).FullName)
    $signature = [IO.File]::ReadAllBytes((Get-Item -LiteralPath $SignaturePath -Force -ErrorAction Stop).FullName)
    $cms = [Security.Cryptography.Pkcs.SignedCms]::new([Security.Cryptography.Pkcs.ContentInfo]::new($content), $true)
    $cms.Decode($signature)
    $cms.CheckSignature($false)
    if ($cms.SignerInfos.Count -ne 1 -or -not $cms.SignerInfos[0].Certificate) {
        throw 'Detached CMS data must have exactly one signer.'
    }
    if (($cms.SignerInfos[0].Certificate.Thumbprint -replace '\s', '').ToUpperInvariant() -ne
        (Normalize-Thumbprint -Thumbprint $ExpectedThumbprint)) {
        throw 'Detached CMS signer does not match the allowlisted signer.'
    }
}

function New-DetachedSignature {
    param(
        [Parameter(Mandatory)][string]$ContentPath,
        [Parameter(Mandatory)][Security.Cryptography.X509Certificates.X509Certificate2]$Certificate,
        [Parameter(Mandatory)][string]$SignaturePath
    )
    Add-Type -AssemblyName System.Security.Cryptography.Pkcs
    $content = [IO.File]::ReadAllBytes((Get-Item -LiteralPath $ContentPath -Force -ErrorAction Stop).FullName)
    $cms = [Security.Cryptography.Pkcs.SignedCms]::new([Security.Cryptography.Pkcs.ContentInfo]::new($content), $true)
    $signer = [Security.Cryptography.Pkcs.CmsSigner]::new($Certificate)
    $signer.IncludeOption = [Security.Cryptography.X509Certificates.X509IncludeOption]::EndCertOnly
    $cms.ComputeSignature($signer, $false)
    [IO.File]::WriteAllBytes($SignaturePath, $cms.Encode())
}

function Add-PassedCheck {
    param([Parameter(Mandatory)][string]$Id, [Parameter(Mandatory)][string]$Summary, $Details)
    $script:checks.Add([ordered]@{ id = $Id; status = 'PASS'; summary = $Summary; details = $Details })
}

function Assert-Condition {
    param([Parameter(Mandatory)][bool]$Condition, [Parameter(Mandatory)][string]$Failure)
    if (-not $Condition) { throw $Failure }
}

function Get-PathBelowRoot {
    param([Parameter(Mandatory)][string]$Root, [Parameter(Mandatory)][string]$Relative)
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative.Contains('..') -or $Relative.Contains(':')) {
        throw "Unsafe manifest relative path: $Relative"
    }
    $rootPath = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $path = [IO.Path]::GetFullPath((Join-Path $rootPath ($Relative -replace '/', '\')))
    if (-not $path.StartsWith($rootPath + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw "Manifest path escapes candidate root: $Relative"
    }
    return $path
}

function Get-AllowMask {
    param([Parameter(Mandatory)][string]$Sddl, [Parameter(Mandatory)][string]$Sid)
    $descriptor = [Security.AccessControl.CommonSecurityDescriptor]::new($false, $false, $Sddl)
    $mask = 0
    foreach ($ace in $descriptor.DiscretionaryAcl) {
        if ($ace.AceQualifier -eq [Security.AccessControl.AceQualifier]::AccessAllowed -and
            $ace.SecurityIdentifier.Value -eq $Sid) {
            $mask = $mask -bor $ace.AccessMask
        }
    }
    return $mask
}

function Invoke-SystemProbe {
    param([Parameter(Mandatory)][string]$ProbeBody)
    if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
        throw 'The ScheduledTasks module is required for an isolated LocalSystem ACL probe.'
    }
    $probeId = [Guid]::NewGuid().ToString('N')
    $taskName = "Itemba-Msaidizi-Acceptance-$probeId"
    $resultPath = Join-Path $script:probeRoot "probe-$probeId.json"
    $escapedResult = $resultPath.Replace("'", "''")
    $payload = @"
`$ErrorActionPreference = 'Stop'
try {
  `$value = & {
$ProbeBody
  }
  [ordered]@{ success = `$true; value = `$value } | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 20 | Set-Content -LiteralPath '$escapedResult' -Encoding utf8
}
catch {
  [ordered]@{ success = `$false; error = `$_.Exception.ToString() } | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 20 | Set-Content -LiteralPath '$escapedResult' -Encoding utf8
  exit 1
}
"@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($payload))
    $action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoLogo -NoProfile -NonInteractive -EncodedCommand $encoded"
    $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    try {
        Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Force -ErrorAction Stop | Out-Null
        Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
        $deadline = [DateTime]::UtcNow.AddSeconds(60)
        while (-not (Test-Path -LiteralPath $resultPath)) {
            if ([DateTime]::UtcNow -ge $deadline) { throw "LocalSystem probe timed out: $taskName" }
            Start-Sleep -Milliseconds 250
        }
        $result = Get-Content -LiteralPath $resultPath -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
        if (-not $result.success) { throw "LocalSystem probe failed: $($result.error)" }
        return $result.value
    }
    finally {
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    }
}

function Invoke-Msi {
    param([Parameter(Mandatory)][ValidateSet('install', 'uninstall')][string]$Operation, [Parameter(Mandatory)][string]$MsiPath, [Parameter(Mandatory)][string]$LogPath)
    $mode = if ($Operation -eq 'install') { '/i' } else { '/x' }
    & "$env:SystemRoot\System32\msiexec.exe" $mode $MsiPath '/qn' '/norestart' '/l*v' $LogPath
    if ($LASTEXITCODE -ne 0) {
        throw "MSI $Operation failed with exit code $LASTEXITCODE. See $LogPath"
    }
}

function Invoke-MsiExpectFailure {
    param([Parameter(Mandatory)][string]$MsiPath, [Parameter(Mandatory)][string]$LogPath, [Parameter(Mandatory)][string]$Scenario)
    & "$env:SystemRoot\System32\msiexec.exe" '/i' $MsiPath '/qn' '/norestart' '/l*v' $LogPath
    if ($LASTEXITCODE -eq 0) {
        throw "Adversarial MSI install unexpectedly succeeded: $Scenario"
    }
    foreach ($serviceName in $script:serviceNames) {
        if (Get-Service -Name $serviceName -ErrorAction SilentlyContinue) {
            throw "A service survived the failed $Scenario install: $serviceName"
        }
    }
}

function Reset-AdversarialInstallerFixture {
    if ([IO.Path]::GetFullPath($script:dataRoot) -ne [IO.Path]::GetFullPath((Join-Path $env:ProgramData 'Itemba\Msaidizi')) -or
        [IO.Path]::GetFullPath($script:binaryRoot) -ne [IO.Path]::GetFullPath((Join-Path $env:ProgramFiles 'Itemba\Msaidizi Companion'))) {
        throw 'Refusing to clean a non-canonical adversarial installer fixture.'
    }
    foreach ($path in @($script:dataRoot, $script:binaryRoot)) {
        if (Test-Path -LiteralPath $path) {
            $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                Remove-Item -LiteralPath $path -Force -ErrorAction Stop
            }
            else {
                Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction Stop
            }
        }
    }
    $itembaParent = Join-Path $env:ProgramData 'Itemba'
    if (Test-Path -LiteralPath $itembaParent) {
        $children = @(Get-ChildItem -LiteralPath $itembaParent -Force -ErrorAction Stop)
        if ($children.Count -eq 0) {
            Remove-Item -LiteralPath $itembaParent -Force -ErrorAction Stop
        }
    }
}

Assert-Administrator
$releaseThumbprint = Normalize-Thumbprint -Thumbprint $ReleaseSignerThumbprint
$evidenceThumbprint = Normalize-Thumbprint -Thumbprint $EvidenceSigningThumbprint
if ($releaseThumbprint -eq $evidenceThumbprint) {
    throw 'Release and VM-evidence signing identities must be separate.'
}
$selfSignature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $PSCommandPath
if ($selfSignature.Status -ne [Management.Automation.SignatureStatus]::Valid -or
    -not $selfSignature.SignerCertificate -or
    ($selfSignature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant() -ne $releaseThumbprint) {
    throw 'The VM acceptance script must be Authenticode-valid under the expected release signer.'
}
$evidenceCertificate = Get-ExactCertificate -Thumbprint $evidenceThumbprint -RequirePrivateKey

$candidateRoot = Resolve-Directory -Path $CandidatePath -Description 'release candidate'
$evidenceRoot = Resolve-Directory -Path $EvidenceOutputDirectory -Description 'VM evidence output'
if ($evidenceRoot.StartsWith($candidateRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $candidateRoot.StartsWith($evidenceRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
    $evidenceRoot -eq $candidateRoot) {
    throw 'VM evidence output must be separate from the immutable release candidate.'
}
$runGuid = [Guid]::Empty
if (-not [Guid]::TryParseExact($VmRunId, 'D', [ref]$runGuid) -or $runGuid -eq [Guid]::Empty) {
    throw 'VmRunId must be a non-empty canonical GUID supplied by the VM orchestrator.'
}
foreach ($value in @($CleanTemplateId, $SnapshotId, $VmProvider)) {
    if ($value.Length -gt 200 -or $value -notmatch '^[A-Za-z0-9][A-Za-z0-9._:/-]+$') {
        throw 'VM orchestration identifiers must be bounded, non-empty, and contain only safe identifier characters.'
    }
}

$manifestPath = Join-Path $candidateRoot 'release-manifest.json'
$manifestSignaturePath = "$manifestPath.p7s"
Assert-DetachedSignature -ContentPath $manifestPath -SignaturePath $manifestSignaturePath -ExpectedThumbprint $releaseThumbprint
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
Assert-Condition ($manifest.schemaVersion -eq 1) 'Unsupported release manifest schema.'
Assert-Condition ($manifest.status -eq 'AWAITING_SIGNED_DISPOSABLE_VM_ACCEPTANCE') 'Candidate is not awaiting VM acceptance.'
Assert-Condition ($manifest.codeSigningThumbprint -eq $releaseThumbprint) 'Manifest release signer mismatch.'

$manifestPaths = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($entry in @($manifest.files)) {
    $relative = [string]$entry.path
    Assert-Condition ($manifestPaths.Add($relative)) "Duplicate manifest path: $relative"
    $path = Get-PathBelowRoot -Root $candidateRoot -Relative $relative
    $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
    Assert-Condition (-not $item.PSIsContainer) "Manifest entry is not a file: $relative"
    Assert-Condition ($item.Length -eq [long]$entry.size) "Manifest size mismatch: $relative"
    Assert-Condition ((Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -eq ([string]$entry.sha256).ToLowerInvariant()) "Manifest hash mismatch: $relative"
}
$actualFiles = @(Get-ChildItem -LiteralPath $candidateRoot -Recurse -File | ForEach-Object {
    $_.FullName.Substring($candidateRoot.Length + 1).Replace('\', '/')
} | Where-Object { $_ -notin @('release-manifest.json', 'release-manifest.json.p7s') })
Assert-Condition ($actualFiles.Count -eq $manifestPaths.Count) 'Candidate contains missing or unmanifested files.'
foreach ($relative in $actualFiles) {
    Assert-Condition ($manifestPaths.Contains($relative)) "Unmanifested candidate file: $relative"
}
Add-PassedCheck -Id 'candidate.integrity' -Summary 'Detached manifest signature, every hash, and exact file set verified.' -Details @{ fileCount = $actualFiles.Count }

$msiPath = Get-PathBelowRoot -Root $candidateRoot -Relative ([string]$manifest.msi.path)
Assert-Condition ((Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $msiPath -Algorithm SHA256).Hash.ToLowerInvariant() -eq ([string]$manifest.msi.sha256).ToLowerInvariant()) 'MSI hash does not match the signed manifest.'
foreach ($entry in @($manifest.files)) {
    $path = Get-PathBelowRoot -Root $candidateRoot -Relative ([string]$entry.path)
    if ([IO.Path]::GetExtension($path) -in @('.exe', '.dll', '.sys', '.ps1', '.psm1', '.psd1', '.msi')) {
        $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $path
        Assert-Condition ($signature.Status -eq [Management.Automation.SignatureStatus]::Valid) "Invalid Authenticode signature: $($entry.path)"
    }
}
$msiSignature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $msiPath
Assert-Condition ($msiSignature.Status -eq [Management.Automation.SignatureStatus]::Valid -and
    $msiSignature.SignerCertificate -and
    ($msiSignature.SignerCertificate.Thumbprint -replace '\s', '').ToUpperInvariant() -eq $releaseThumbprint) 'MSI is not signed by the expected release identity.'
Add-PassedCheck -Id 'candidate.authenticode' -Summary 'All PE/script/MSI signatures are valid; MSI signer is exact.' -Details @{ signer = $releaseThumbprint }

$operatingSystem = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
$computerSystem = Get-CimInstance Win32_ComputerSystem -ErrorAction Stop
$tpm = Get-Tpm -ErrorAction Stop
$tpmCim = Get-CimInstance -Namespace 'root\CIMV2\Security\MicrosoftTpm' -ClassName Win32_Tpm -ErrorAction Stop
$programDataDrive = [IO.Path]::GetPathRoot($env:ProgramData).TrimEnd('\').TrimEnd(':')
$programDataVolume = Get-Volume -DriveLetter $programDataDrive -ErrorAction Stop
Assert-Condition ([int]$operatingSystem.BuildNumber -ge 22000) 'Guest OS must be Windows 11 build 22000 or newer.'
Assert-Condition ($operatingSystem.OSArchitecture -match '64') 'Guest OS must be x64.'
Assert-Condition ([bool]$computerSystem.HypervisorPresent) 'Guest did not report a hypervisor; bare-metal acceptance is forbidden.'
Assert-Condition ($tpm.TpmPresent -and $tpm.TpmReady) 'TPM must be present and ready.'
Assert-Condition ([string]$tpmCim.SpecVersion -match '(^|,)2\.0(,|$)') 'TPM 2.0 was not reported.'
Assert-Condition ($programDataVolume.FileSystem -eq 'NTFS') 'ProgramData must reside on NTFS.'
Add-PassedCheck -Id 'vm.prerequisites' -Summary 'Windows 11 x64 hypervisor guest, TPM 2.0, and NTFS verified.' -Details @{
    build = [int]$operatingSystem.BuildNumber
    architecture = [string]$operatingSystem.OSArchitecture
    hypervisorPresent = [bool]$computerSystem.HypervisorPresent
    tpmSpecVersion = [string]$tpmCim.SpecVersion
    fileSystem = [string]$programDataVolume.FileSystem
}

$binaryRoot = Join-Path $env:ProgramFiles 'Itemba\Msaidizi Companion'
$dataRoot = Join-Path $env:ProgramData 'Itemba\Msaidizi'
$serviceNames = @(
    'Itemba Msaidizi Companion',
    'Itemba Msaidizi Update Supervisor',
    'Itemba Msaidizi Recovery Supervisor',
    'Itemba Msaidizi Audit Signer',
    'Itemba Msaidizi Egress Supervisor',
    'Itemba Msaidizi Privileged Command Supervisor'
)
$script:binaryRoot = $binaryRoot
$script:dataRoot = $dataRoot
$script:serviceNames = $serviceNames
Assert-Condition (-not (Test-Path -LiteralPath $binaryRoot)) 'Disposable VM is not clean: product binary root already exists.'
Assert-Condition (-not (Test-Path -LiteralPath $dataRoot)) 'Disposable VM is not clean: product data root already exists.'
foreach ($serviceName in $serviceNames) {
    Assert-Condition (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) "Disposable VM is not clean: service already exists: $serviceName"
}

$script:probeRoot = Join-Path $env:ProgramData "ItembaMsaidiziAcceptance\$($runGuid.ToString('D'))"
New-Item -ItemType Directory -Path $script:probeRoot -Force -ErrorAction Stop | Out-Null
$itembaParent = Split-Path -Parent $dataRoot

New-Item -ItemType Directory -Path $itembaParent -Force -ErrorAction Stop | Out-Null
$attackerAcl = [Security.AccessControl.DirectorySecurity]::new()
$attackerAcl.SetAccessRuleProtection($true, $false)
$attackerAcl.SetOwner([Security.Principal.WindowsIdentity]::GetCurrent().User)
$attackerAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    [Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::BuiltinUsersSid, $null),
    [Security.AccessControl.FileSystemRights]::FullControl,
    [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
    [Security.AccessControl.PropagationFlags]::None,
    [Security.AccessControl.AccessControlType]::Allow))
Set-Acl -LiteralPath $itembaParent -AclObject $attackerAcl -ErrorAction Stop
Invoke-MsiExpectFailure -MsiPath $msiPath `
    -LogPath (Join-Path $evidenceRoot "msi-reject-attacker-parent-$($runGuid.ToString('N')).log") `
    -Scenario 'attacker-owned ProgramData parent'
Reset-AdversarialInstallerFixture

$junctionTarget = Join-Path $script:probeRoot 'junction-target'
New-Item -ItemType Directory -Path $itembaParent -Force -ErrorAction Stop | Out-Null
New-Item -ItemType Directory -Path $junctionTarget -Force -ErrorAction Stop | Out-Null
New-Item -ItemType Junction -Path $dataRoot -Target $junctionTarget -ErrorAction Stop | Out-Null
Invoke-MsiExpectFailure -MsiPath $msiPath `
    -LogPath (Join-Path $evidenceRoot "msi-reject-junction-root-$($runGuid.ToString('N')).log") `
    -Scenario 'junction data root'
Reset-AdversarialInstallerFixture

$preplantedConfig = Join-Path $dataRoot 'config\service\appsettings.json'
New-Item -ItemType Directory -Path (Split-Path -Parent $preplantedConfig) -Force -ErrorAction Stop | Out-Null
[IO.File]::WriteAllText(
    $preplantedConfig,
    '{"Companion":{"ExecutionEnabled":true},"PrivilegedCommand":{"Enabled":true}}',
    [Text.UTF8Encoding]::new($false))
Invoke-MsiExpectFailure -MsiPath $msiPath `
    -LogPath (Join-Path $evidenceRoot "msi-reject-preplanted-config-$($runGuid.ToString('N')).log") `
    -Scenario 'preplanted NeverOverwrite configuration'
Reset-AdversarialInstallerFixture
Add-PassedCheck -Id 'install.adversarial-preplant' -Summary 'MSI failed closed for attacker-owned parent, junction root, and preplanted enabled configuration fixtures.' -Details @{
    attackerOwnedParent = 'rejected'
    junctionRoot = 'rejected'
    preplantedConfiguration = 'rejected'
}

$journalSentinel = Join-Path $dataRoot "journal\vm-preservation-$($runGuid.ToString('N')).txt"
$recoverySentinel = Join-Path $dataRoot "supervisor\recovery-vault\vm-preservation-$($runGuid.ToString('N')).txt"
$configSentinel = Join-Path $dataRoot "config\service\vm-preservation-$($runGuid.ToString('N')).txt"
$installLog = Join-Path $evidenceRoot "msi-install-$($runGuid.ToString('N')).log"
$uninstallLog = Join-Path $evidenceRoot "msi-uninstall-$($runGuid.ToString('N')).log"
Invoke-Msi -Operation install -MsiPath $msiPath -LogPath $installLog

$services = @{}
$serviceRegistryKeys = @{}
foreach ($serviceName in $serviceNames) {
    $service = Get-CimInstance Win32_Service -Filter "Name='$($serviceName.Replace("'", "''"))'" -ErrorAction Stop
    $services[$serviceName] = $service
    Assert-Condition ($service.StartName -eq 'LocalSystem') "$serviceName does not run as LocalSystem."
    Assert-Condition ($service.State -eq 'Stopped') "$serviceName was started by MSI; provisioning must start it explicitly."
    $serviceKey = Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\$serviceName" -ErrorAction Stop
    $serviceRegistryKeys[$serviceName] = $serviceKey
    Assert-Condition ([int]$serviceKey.ServiceSidType -eq 3) "$serviceName is not using a restricted service SID."
    Assert-Condition ([string]$service.PathName -match '(?i)--contentRoot') "$serviceName does not receive an explicit contentRoot."
}
Assert-Condition ($services['Itemba Msaidizi Companion'].StartMode -eq 'Auto') 'Main companion service must be automatic.'
$mainServiceKey = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\Itemba Msaidizi Companion' -ErrorAction Stop
Assert-Condition ([int]$mainServiceKey.DelayedAutoStart -eq 1) 'Main companion service is not delayed automatic.'
$mainDependencies = @($mainServiceKey.DependOnService | Sort-Object)
$expectedMainDependencies = @(
    'Itemba Msaidizi Egress Supervisor',
    'Itemba Msaidizi Privileged Command Supervisor'
) | Sort-Object
Assert-Condition (($mainDependencies -join '|') -ceq ($expectedMainDependencies -join '|')) 'Main companion service does not depend on both enforcement supervisors exactly.'
Assert-Condition ($services['Itemba Msaidizi Update Supervisor'].StartMode -eq 'Manual') 'Update supervisor must be demand-start.'
Assert-Condition ($services['Itemba Msaidizi Recovery Supervisor'].StartMode -eq 'Manual') 'Recovery supervisor must be demand-start.'
Assert-Condition ($services['Itemba Msaidizi Audit Signer'].StartMode -eq 'Manual') 'Audit signer must be demand-start.'
foreach ($enforcementService in @('Itemba Msaidizi Egress Supervisor', 'Itemba Msaidizi Privileged Command Supervisor')) {
    Assert-Condition ($services[$enforcementService].StartMode -eq 'Auto') "$enforcementService must be automatic."
    $enforcementKey = Get-ItemProperty -LiteralPath "HKLM:\SYSTEM\CurrentControlSet\Services\$enforcementService" -ErrorAction Stop
    Assert-Condition ([int]$enforcementKey.DelayedAutoStart -ne 1) "$enforcementService must not be delayed automatic."
}
$expectedServicePrivileges = [ordered]@{
    'Itemba Msaidizi Companion' = @('SeAssignPrimaryTokenPrivilege', 'SeChangeNotifyPrivilege', 'SeImpersonatePrivilege', 'SeIncreaseQuotaPrivilege', 'SeShutdownPrivilege', 'SeSystemtimePrivilege')
    'Itemba Msaidizi Update Supervisor' = @('SeChangeNotifyPrivilege')
    'Itemba Msaidizi Recovery Supervisor' = @('SeBackupPrivilege', 'SeChangeNotifyPrivilege', 'SeRestorePrivilege', 'SeSecurityPrivilege', 'SeShutdownPrivilege', 'SeTakeOwnershipPrivilege')
    'Itemba Msaidizi Audit Signer' = @('SeChangeNotifyPrivilege')
    'Itemba Msaidizi Egress Supervisor' = @('SeChangeNotifyPrivilege', 'SeImpersonatePrivilege')
    'Itemba Msaidizi Privileged Command Supervisor' = @('SeChangeNotifyPrivilege', 'SeImpersonatePrivilege')
}
foreach ($serviceName in $expectedServicePrivileges.Keys) {
    $expectedPrivileges = @($expectedServicePrivileges[$serviceName] | Sort-Object)
    $actualPrivileges = @($serviceRegistryKeys[$serviceName].RequiredPrivileges | Sort-Object)
    Assert-Condition (($actualPrivileges -join '|') -ceq ($expectedPrivileges -join '|')) "$serviceName required-privilege list is not the reviewed exact set."
}
Add-PassedCheck -Id 'services.install-state' -Summary 'All six exact service accounts, restricted SIDs, dependencies, start modes, content roots, and privileges verified.' -Details @{ main = 'automatic-delayed/stopped'; enforcementSupervisors = 'automatic-nondelayed/stopped'; otherSupervisors = 'demand/stopped' }

$configs = @{
    service = Get-Content -LiteralPath (Join-Path $dataRoot 'config\service\appsettings.json') -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
    agent = Get-Content -LiteralPath (Join-Path $dataRoot 'config\agent\appsettings.json') -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
    update = Get-Content -LiteralPath (Join-Path $dataRoot 'config\update\appsettings.json') -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
    recovery = Get-Content -LiteralPath (Join-Path $dataRoot 'config\recovery\appsettings.json') -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
    auditSigner = Get-Content -LiteralPath (Join-Path $dataRoot 'config\audit-signer\appsettings.json') -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
    egressSupervisor = Get-Content -LiteralPath (Join-Path $dataRoot 'config\egress-supervisor\appsettings.json') -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
    privilegedCommandSupervisor = Get-Content -LiteralPath (Join-Path $dataRoot 'config\privileged-command-supervisor\appsettings.json') -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
}
Assert-Condition (-not $configs.service.Companion.ExecutionEnabled) 'Main execution is enabled before provisioning.'
Assert-Condition (-not $configs.service.HostCapabilities.Enabled) 'Main host capabilities are enabled before provisioning.'
Assert-Condition (-not $configs.service.SystemPower.Enabled) 'Main system-power capabilities are enabled before provisioning.'
Assert-Condition ($configs.service.SystemPower.RestartDelaySeconds -eq 120) 'The packaged system restart delay is not the reviewed 120-second default.'
$expectedSystemPowerKeys = @('Enabled', 'RestartDelaySeconds') | Sort-Object
$actualSystemPowerKeys = @($configs.service.SystemPower.PSObject.Properties.Name | Sort-Object)
Assert-Condition (($actualSystemPowerKeys -join '|') -ceq ($expectedSystemPowerKeys -join '|')) 'The packaged SystemPower section contains an unknown, stale, or model-controlled key.'
Assert-Condition (-not $configs.service.BrokerChannel.Enabled) 'Main broker channel is enabled before provisioning.'
Assert-Condition (-not $configs.service.SessionBridge.Enabled) 'Main session bridge is enabled before provisioning.'
Assert-Condition (-not $configs.service.SecretProvisioning.Enabled -and @($configs.service.SecretProvisioning.Bindings).Count -eq 0) 'Main secret provisioning is enabled or pre-bound before provisioning.'
Assert-Condition ($configs.service.Companion.DeviceId -eq 'UNENROLLED') 'Main service was installed with a pre-enrolled device identity.'
Assert-Condition ($configs.service.BrokerChannel.RequireHardwareBackedDeviceIdentity -and -not $configs.service.BrokerChannel.DevelopmentOnlyAllowSoftwareDeviceIdentity -and $configs.service.BrokerChannel.PreferTpm) 'Main service does not require TPM-backed device identity or permits the development-only Software KSP override.'
Assert-Condition (-not $configs.agent.Agent.ExecutionEnabled -and -not $configs.agent.SessionBridge.Enabled -and -not $configs.agent.SecretProvisioning.Enabled) 'Agent execution/session/secret provisioning is enabled before provisioning.'
Assert-Condition (@($configs.service.TokenVerification.TrustedSigningCertificates).Count -eq 0) 'A placeholder trusted action signer was installed.'
Assert-Condition (-not $configs.service.EgressAttestationTrust.Enabled -and @($configs.service.EgressAttestationTrust.TrustedSupervisorCertificates).Count -eq 0 -and @($configs.service.EgressAttestationTrust.PairedDeviceCertificateThumbprints).Count -eq 0) 'Egress attestation trust was enabled or provisioned by the packaged installer.'
Assert-Condition ([string]::IsNullOrEmpty([string]$configs.update.MsaidiziUpdateSupervisor.ClientCertificateThumbprint)) 'Update supervisor has a pre-provisioned client identity.'
Assert-Condition ([string]::IsNullOrEmpty([string]$configs.recovery.MsaidiziRecoverySupervisor.ClientCertificateThumbprint)) 'Recovery supervisor has a pre-provisioned client identity.'
Assert-Condition ($configs.recovery.BrokerChannel.RequireHardwareBackedDeviceIdentity -and -not $configs.recovery.BrokerChannel.DevelopmentOnlyAllowSoftwareDeviceIdentity -and $configs.recovery.BrokerChannel.PreferTpm) 'Recovery service does not preserve the TPM-backed device identity policy.'
Assert-Condition ([string]::IsNullOrEmpty([string]$configs.auditSigner.MsaidiziAuditSigner.ClientCertificateThumbprint) -and $configs.auditSigner.MsaidiziAuditSigner.SignerKeyId -eq 'PROVISIONING_REQUIRED') 'Audit signer has a pre-provisioned signing identity.'
Assert-Condition ($configs.auditSigner.MsaidiziAuditSigner.HardwareKeyProvider -eq 'Microsoft Platform Crypto Provider') 'Audit signer does not require the hardware CNG provider.'
Assert-Condition (-not $configs.egressSupervisor.EgressSupervisor.Enabled -and -not $configs.egressSupervisor.EgressSupervisor.DriverActive) 'Egress supervisor is active before independent driver provisioning.'
Assert-Condition ([string]::IsNullOrEmpty([string]$configs.egressSupervisor.EgressSupervisor.AttestationCertificateThumbprint) -and [string]::IsNullOrEmpty([string]$configs.egressSupervisor.EgressSupervisor.ReceiptCertificateThumbprint)) 'Egress supervisor contains pre-provisioned signing identities.'
$egressSupervisorSafe = $configs.egressSupervisor.EgressSupervisor
Assert-Condition ($egressSupervisorSafe.KillSwitchPath -ceq 'C:\ProgramData\Itemba\Msaidizi\supervisor\DISABLED') 'Egress supervisor is not bound to the shared trusted-root kill switch.'
Assert-Condition ($egressSupervisorSafe.SecretVaultPath -ceq 'C:\ProgramData\Itemba\Msaidizi\supervisor\secret-vault') 'Egress supervisor is not bound read-only to the Companion-provisioned secret vault.'
Assert-Condition ($egressSupervisorSafe.FlowOperationTimeoutSeconds -eq 120 -and
    $egressSupervisorSafe.MaximumRequestBytes -eq 1048576 -and
    $egressSupervisorSafe.MaximumResponseBytes -eq 16777216 -and
    $egressSupervisorSafe.FlowCompletionSettlementTimeoutMilliseconds -eq 5000) 'Egress exact-request flow bounds differ from the reviewed safe-off defaults.'
Assert-Condition (-not $configs.privilegedCommandSupervisor.PrivilegedCommandSupervisor.Enabled) 'Privileged-command isolation supervisor is active before independent driver provisioning.'
$isolationSupervisorSafe = $configs.privilegedCommandSupervisor.PrivilegedCommandSupervisor
$isolationClientSafe = $configs.service.PrivilegedCommandIsolationClient
Assert-Condition ($isolationClientSafe.ProtocolVersion -eq 2 -and
    $isolationSupervisorSafe.PipeName -ceq 'Itemba.Msaidizi.PrivilegedCommandIsolation.v2') 'Privileged-command client/supervisor protocol is not the exact independently verifying v2 contract.'
$isolationSigningKeyExpectations = [ordered]@{
    ReservationLeaseSigningKey = [ordered]@{ KeyId = 'reservation-lease-v1'; Thumbprint = ('0' * 40); CompanionPublicKey = 'ReservationLeasePublicKey' }
    PreBindReservationReleaseSigningKey = [ordered]@{ KeyId = 'pre-bind-reservation-release-v1'; Thumbprint = ('1' * 40); CompanionPublicKey = 'PreBindReservationReleasePublicKey' }
    SuspendedProcessBindAcknowledgementSigningKey = [ordered]@{ KeyId = 'suspended-process-bind-acknowledgement-v1'; Thumbprint = ('2' * 40); CompanionPublicKey = 'SuspendedProcessBindAcknowledgementPublicKey' }
    TerminalEnforcementReceiptSigningKey = [ordered]@{ KeyId = 'terminal-enforcement-receipt-v1'; Thumbprint = ('3' * 40); CompanionPublicKey = 'TerminalEnforcementReceiptPublicKey' }
}
$isolationSigningKeyIds = [Collections.Generic.List[string]]::new()
$isolationSigningThumbprints = [Collections.Generic.List[string]]::new()
foreach ($bindingName in $isolationSigningKeyExpectations.Keys) {
    $binding = $isolationSupervisorSafe.$bindingName
    $expectedBinding = $isolationSigningKeyExpectations[$bindingName]
    $actualBindingProperties = @($binding.PSObject.Properties.Name | Sort-Object)
    $expectedBindingProperties = @('CertificateThumbprint', 'KeyId', 'SubjectPublicKeyInfoBase64') | Sort-Object
    Assert-Condition (($actualBindingProperties -join '|') -ceq ($expectedBindingProperties -join '|')) "Privileged-command signing binding has unknown or missing fields: $bindingName"
    Assert-Condition ($binding.KeyId -ceq $expectedBinding.KeyId -and
        $binding.CertificateThumbprint -ceq $expectedBinding.Thumbprint -and
        [string]::IsNullOrEmpty([string]$binding.SubjectPublicKeyInfoBase64)) "Privileged-command signing binding is provisioned or not purpose-separated: $bindingName"
    $companionPublicKey = $isolationClientSafe.($expectedBinding.CompanionPublicKey)
    Assert-Condition ([string]::IsNullOrEmpty([string]$companionPublicKey.KeyId) -and
        [string]::IsNullOrEmpty([string]$companionPublicKey.SubjectPublicKeyInfoBase64)) "Companion has a pre-provisioned isolation public-key pin: $($expectedBinding.CompanionPublicKey)"
    $isolationSigningKeyIds.Add([string]$binding.KeyId)
    $isolationSigningThumbprints.Add([string]$binding.CertificateThumbprint)
}
$isolationVerificationKeyExpectations = [ordered]@{
    ActionTokenVerificationKey = [ordered]@{ KeyId = 'msaidizi-action-token-v1'; Thumbprint = ('4' * 40) }
    DriverAttestationVerificationKey = [ordered]@{ KeyId = 'isolation-driver-attestation-v2'; Thumbprint = ('5' * 40) }
}
foreach ($bindingName in $isolationVerificationKeyExpectations.Keys) {
    $binding = $isolationSupervisorSafe.$bindingName
    $expectedBinding = $isolationVerificationKeyExpectations[$bindingName]
    $actualBindingProperties = @($binding.PSObject.Properties.Name | Sort-Object)
    $expectedBindingProperties = @('CertificateThumbprint', 'KeyId', 'SubjectPublicKeyInfoBase64') | Sort-Object
    Assert-Condition (($actualBindingProperties -join '|') -ceq ($expectedBindingProperties -join '|')) "Privileged-command verification binding has unknown or missing fields: $bindingName"
    Assert-Condition ($binding.KeyId -ceq $expectedBinding.KeyId -and
        $binding.CertificateThumbprint -ceq $expectedBinding.Thumbprint -and
        [string]::IsNullOrEmpty([string]$binding.SubjectPublicKeyInfoBase64)) "Privileged-command verification binding is provisioned or not purpose-separated: $bindingName"
    $isolationSigningKeyIds.Add([string]$binding.KeyId)
    $isolationSigningThumbprints.Add([string]$binding.CertificateThumbprint)
}
Assert-Condition (@($isolationSigningKeyIds | Select-Object -Unique).Count -eq 6 -and
    @($isolationSigningThumbprints | Select-Object -Unique).Count -eq 6 -and
    $isolationSupervisorSafe.DriverMeasurementSha256 -ceq ('0' * 64)) 'Privileged-command supervisor lacks six purpose-distinct safe-off signing/verification bindings or contains active driver evidence.'
Assert-Condition ($isolationSupervisorSafe.ActionTokenExpectedIssuer -ceq 'itemba-msaidizi-broker' -and
    $isolationSupervisorSafe.ActionTokenExpectedAudience -ceq 'itemba-windows-companion' -and
    $isolationSupervisorSafe.ActionTokenExpectedSubject -ceq 'msaidizi-global' -and
    $isolationSupervisorSafe.ActionTokenAllowedClockSkew -ceq '00:00:30' -and
    $isolationSupervisorSafe.ActionTokenMaximumLifetime -ceq '00:05:00') 'Privileged-command action-token trust scope differs from the existing exact broker contract.'
Assert-Condition ($isolationSupervisorSafe.DriverServiceName -ceq 'Itemba Msaidizi Privileged Command Isolation Driver' -and
    $isolationSupervisorSafe.DriverPolicyEpoch -ceq 'isolation-policy-v2' -and
    $isolationSupervisorSafe.DriverAttestationAllowedClockSkew -ceq '00:00:30' -and
    $isolationSupervisorSafe.DriverAttestationMaximumLifetime -ceq '00:01:00' -and
    $isolationSupervisorSafe.MaximumInvocationTimeoutSeconds -eq 300 -and
    $isolationSupervisorSafe.MaximumInvocationOutputBytes -eq 1048576 -and
    $isolationSupervisorSafe.MaximumInvocationProcesses -eq 16 -and
    $isolationSupervisorSafe.MaximumInvocationProcessMemoryBytes -eq 536870912) 'Privileged-command driver trust scope or per-invocation resource ceilings differ from the reviewed v2 contract.'
$expectedHostCapabilityKeys = @(
    'Enabled', 'PermanentDeleteEnabled', 'RecoveryVaultPath', 'SecretVaultPath',
    'MaximumSearchResults', 'MaximumArgumentCount', 'MaximumArgumentLength',
    'MaximumNetworkAddresses', 'MaximumPrinterDiscoveryResults', 'MaximumSingleFileBytes',
    'MaximumArchiveEntries', 'MaximumArchiveEntryPathLength',
    'MaximumArchiveExpandedBytes', 'MaximumArchiveCompressionRatio',
    'MaximumRecoveryBytes',
    'AllowedRoots', 'AllowedFileAclProfiles', 'AllowedExecutables', 'AllowedRegistryRoots',
    'AllowedMachineEnvironmentVariables', 'AllowedWindowsServices', 'AllowedScheduledTasks',
    'AllowedMsiPackages', 'AllowedLocalAccounts', 'AllowedLocalGroups', 'AllowedNetworkAdapters',
    'AllowedPrinters', 'AllowedPowerSchemes', 'AllowedTimeZones'
) | Sort-Object
foreach ($hostSection in @($configs.service.HostCapabilities, $configs.recovery.HostCapabilities)) {
    $actualHostKeys = @($hostSection.PSObject.Properties.Name | Sort-Object)
    Assert-Condition (($actualHostKeys -join '|') -ceq ($expectedHostCapabilityKeys -join '|')) 'A packaged HostCapabilities section contains an unknown, stale, or unbound key.'
    foreach ($allowlist in @($expectedHostCapabilityKeys | Where-Object { $_.StartsWith('Allowed', [StringComparison]::Ordinal) })) {
        Assert-Condition (@($hostSection.$allowlist).Count -eq 0) "A packaged HostCapabilities operational allowlist is not empty: $allowlist"
    }
}
foreach ($allowlist in @($configs.agent.Agent.PSObject.Properties.Name | Where-Object { $_.StartsWith('Allowed', [StringComparison]::Ordinal) })) {
    Assert-Condition (@($configs.agent.Agent.$allowlist).Count -eq 0) "The packaged Agent operational allowlist is not empty: $allowlist"
}
Assert-Condition ($configs.agent.Agent.DeviceId -eq 'UNENROLLED') 'Agent was installed with a pre-enrolled device identity.'
Assert-Condition (Test-Path -LiteralPath (Join-Path $dataRoot 'supervisor\DISABLED')) 'Protected DISABLED kill switch is missing.'
Add-PassedCheck -Id 'configuration.fail-closed' -Summary 'All seven configs keep execution, enforcement drivers, broker, system power, bridge, secret provisioning, identities, and every operational allowlist disabled.' -Details @{ killSwitch = $true; systemPowerEnabled = $false; egressSupervisorEnabled = $false; privilegedCommandSupervisorEnabled = $false; restartDelaySeconds = 120 }

$runValue = (Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -Name 'Itemba Msaidizi Agent' -ErrorAction Stop).'Itemba Msaidizi Agent'
$agentPath = Join-Path $binaryRoot 'Agent\Itemba.Msaidizi.Companion.Agent.exe'
Assert-Condition ($runValue -eq "`"$agentPath`" --contentRoot `"$dataRoot\config\agent\`"") 'Agent per-user Run registration is not exact.'
$agentBytes = [IO.File]::ReadAllBytes($agentPath)
$agentImageText = [Text.Encoding]::UTF8.GetString($agentBytes) + [Text.Encoding]::Unicode.GetString($agentBytes)
Assert-Condition ($agentImageText -match 'requestedExecutionLevel\s+level=["'']asInvoker["'']') 'Agent does not contain an asInvoker execution-level manifest.'
Add-PassedCheck -Id 'agent.standard-integrity' -Summary 'Agent uses ordinary per-user Run startup with an asInvoker manifest.' -Details @{ startup = 'HKLM Run' }

$mainSid = ([Security.Principal.NTAccount]::new('NT SERVICE', 'Itemba Msaidizi Companion')).Translate([Security.Principal.SecurityIdentifier]).Value
$updateSid = ([Security.Principal.NTAccount]::new('NT SERVICE', 'Itemba Msaidizi Update Supervisor')).Translate([Security.Principal.SecurityIdentifier]).Value
$recoverySid = ([Security.Principal.NTAccount]::new('NT SERVICE', 'Itemba Msaidizi Recovery Supervisor')).Translate([Security.Principal.SecurityIdentifier]).Value
$auditSignerSid = ([Security.Principal.NTAccount]::new('NT SERVICE', 'Itemba Msaidizi Audit Signer')).Translate([Security.Principal.SecurityIdentifier]).Value
$egressSupervisorSid = ([Security.Principal.NTAccount]::new('NT SERVICE', 'Itemba Msaidizi Egress Supervisor')).Translate([Security.Principal.SecurityIdentifier]).Value
$privilegedCommandSupervisorSid = ([Security.Principal.NTAccount]::new('NT SERVICE', 'Itemba Msaidizi Privileged Command Supervisor')).Translate([Security.Principal.SecurityIdentifier]).Value
$usersSid = ([Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::BuiltinUsersSid, $null)).Value
$adminsSid = ([Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::BuiltinAdministratorsSid, $null)).Value
$recoveryGroup = Get-LocalGroup -Name 'Itemba Msaidizi Recovery Operators' -ErrorAction Stop
$operatorSid = $recoveryGroup.SID.Value
$sentinelText = "VM acceptance preservation sentinel $($runGuid.ToString('D'))"
$sentinelSetup = Invoke-SystemProbe -ProbeBody @"
`$sentinels = @(
  '$($journalSentinel.Replace("'", "''"))',
  '$($recoverySentinel.Replace("'", "''"))',
  '$($configSentinel.Replace("'", "''"))'
)
foreach (`$sentinel in `$sentinels) {
  [IO.File]::WriteAllText(`$sentinel, '$($sentinelText.Replace("'", "''"))', [Text.UTF8Encoding]::new(`$false))
}
[ordered]@{
  journal = (Test-Path -LiteralPath `$sentinels[0])
  recovery = (Test-Path -LiteralPath `$sentinels[1])
  config = (Test-Path -LiteralPath `$sentinels[2])
}
"@
Assert-Condition ($sentinelSetup.journal -and $sentinelSetup.recovery -and $sentinelSetup.config) 'LocalSystem could not create preservation sentinels after hardening.'
$systemProbeBody = @"
[ordered]@{
  itembaParentOwner = (Get-Acl -LiteralPath '$($itembaParent.Replace("'", "''"))').GetOwner([Security.Principal.SecurityIdentifier]).Value
  itembaParent = (Get-Acl -LiteralPath '$($itembaParent.Replace("'", "''"))').Sddl
  dataRootOwner = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))').GetOwner([Security.Principal.SecurityIdentifier]).Value
  dataRoot = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))').Sddl
  provenanceMarker = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\config\.installer-provenance.v1.json').Sddl
  journal = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\journal').Sddl
  supervisor = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor').Sddl
  egressBoundary = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\egress-boundary').Sddl
  egressReceiptReplay = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\egress-boundary\receipts.v1.jsonl').Sddl
  egressReceiptReplayLock = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\egress-boundary\receipts.v1.jsonl.lock').Sddl
  privilegedCommandIsolation = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\privileged-command-isolation').Sddl
  privilegedCommandReplay = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\privileged-command-isolation\replay.v1.jsonl').Sddl
  privilegedCommandReplayLock = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\privileged-command-isolation\replay.v1.jsonl.lock').Sddl
  egressSupervisor = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\egress-supervisor').Sddl
  egressSupervisorJournal = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\egress-supervisor\lifecycle.v2.jsonl').Sddl
  egressSupervisorJournalLock = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\egress-supervisor\lifecycle.v2.jsonl.lock').Sddl
  privilegedCommandSupervisor = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\privileged-command-supervisor').Sddl
  privilegedCommandSupervisorJournal = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\privileged-command-supervisor\lifecycle.v1.jsonl').Sddl
  privilegedCommandSupervisorJournalLock = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\privileged-command-supervisor\lifecycle.v1.jsonl.lock').Sddl
  applicationVersions = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\application-versions').Sddl
  applicationState = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\application-state').Sddl
  recoveryVault = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\recovery-vault').Sddl
  secretVault = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\secret-vault').Sddl
  secretProvisioning = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\secret-provisioning').Sddl
  auditSigner = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\audit-signer').Sddl
  killSwitch = (Get-Acl -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\DISABLED').Sddl
  journalSentinel = (Test-Path -LiteralPath '$($journalSentinel.Replace("'", "''"))')
  recoverySentinel = (Test-Path -LiteralPath '$($recoverySentinel.Replace("'", "''"))')
}
"@
$protectedState = Invoke-SystemProbe -ProbeBody $systemProbeBody
$writeMask = [int](
    [Security.AccessControl.FileSystemRights]::WriteData -bor
    [Security.AccessControl.FileSystemRights]::AppendData -bor
    [Security.AccessControl.FileSystemRights]::WriteExtendedAttributes -bor
    [Security.AccessControl.FileSystemRights]::WriteAttributes -bor
    [Security.AccessControl.FileSystemRights]::Delete -bor
    [Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
    [Security.AccessControl.FileSystemRights]::ChangePermissions -bor
    [Security.AccessControl.FileSystemRights]::TakeOwnership)
$readMask = [int][Security.AccessControl.FileSystemRights]::ReadAndExecute
$binarySddl = (Get-Acl -LiteralPath $binaryRoot).Sddl
$systemSid = ([Security.Principal.SecurityIdentifier]::new([Security.Principal.WellKnownSidType]::LocalSystemSid, $null)).Value
Assert-Condition ($protectedState.itembaParentOwner -eq $systemSid -and $protectedState.dataRootOwner -eq $systemSid) 'ProgramData parent/root are not exactly SYSTEM-owned.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.itembaParent -Sid $usersSid) -band $writeMask) -eq 0) 'Builtin Users retain write/DELETE_CHILD authority on the Itemba ProgramData parent.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.dataRoot -Sid $usersSid) -band $writeMask) -eq 0) 'Builtin Users retain write/delete authority on the Msaidizi data root.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.provenanceMarker -Sid $usersSid) -band $writeMask) -eq 0) 'Builtin Users can modify installer provenance.'
Assert-Condition (((Get-AllowMask -Sddl $binarySddl -Sid $usersSid) -band $writeMask) -eq 0) 'Builtin Users can write the immutable binary root.'
Assert-Condition (((Get-AllowMask -Sddl $binarySddl -Sid $usersSid) -band $readMask) -ne 0) 'Builtin Users cannot execute installed binaries.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.journal -Sid $mainSid) -band $writeMask) -ne 0) 'Main service cannot append to its journal.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.journal -Sid $adminsSid) -band $writeMask) -eq 0) 'Administrators have ordinary write access to the journal.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.egressBoundary -Sid $mainSid) -band $writeMask) -ne 0) 'Main service cannot durably append egress receipt evidence.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.egressBoundary -Sid $adminsSid) -band $writeMask) -eq 0) 'Administrators have ordinary write access to the egress receipt replay ledger.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.egressBoundary -Sid $operatorSid) -band $writeMask) -eq 0) 'Recovery operators can mutate the egress receipt replay ledger.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.egressReceiptReplay -Sid $mainSid) -band $writeMask) -ne 0) 'Main service cannot append the installer-owned egress receipt ledger.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.egressReceiptReplayLock -Sid $mainSid) -band $writeMask) -ne 0) 'Main service cannot lock the installer-owned egress receipt ledger.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.egressReceiptReplay -Sid $usersSid) -band $writeMask) -eq 0 -and ((Get-AllowMask -Sddl $protectedState.egressReceiptReplayLock -Sid $usersSid) -band $writeMask) -eq 0) 'Builtin Users retain an ACE on the egress receipt ledger or lock.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.privilegedCommandIsolation -Sid $mainSid) -band $writeMask) -ne 0) 'Main service cannot durably append privileged-command isolation evidence.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.privilegedCommandIsolation -Sid $adminsSid) -band $writeMask) -eq 0) 'Administrators have ordinary write access to the privileged-command isolation replay ledger.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.privilegedCommandIsolation -Sid $operatorSid) -band $writeMask) -eq 0) 'Recovery operators can mutate the privileged-command isolation replay ledger.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.privilegedCommandReplay -Sid $mainSid) -band $writeMask) -ne 0) 'Main service cannot append the installer-owned replay ledger.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.privilegedCommandReplayLock -Sid $mainSid) -band $writeMask) -ne 0) 'Main service cannot lock the installer-owned replay ledger.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.privilegedCommandReplay -Sid $usersSid) -band $writeMask) -eq 0 -and ((Get-AllowMask -Sddl $protectedState.privilegedCommandReplayLock -Sid $usersSid) -band $writeMask) -eq 0) 'Builtin Users retain an ACE on the replay ledger or lock.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.egressSupervisor -Sid $egressSupervisorSid) -band $writeMask) -ne 0) 'Egress supervisor cannot mutate its own lifecycle root.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.egressSupervisorJournal -Sid $egressSupervisorSid) -band $writeMask) -ne 0 -and ((Get-AllowMask -Sddl $protectedState.egressSupervisorJournalLock -Sid $egressSupervisorSid) -band $writeMask) -ne 0) 'Egress supervisor cannot own both lifecycle journal targets.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.egressSupervisorJournal -Sid $mainSid) -band $writeMask) -eq 0 -and ((Get-AllowMask -Sddl $protectedState.egressSupervisorJournalLock -Sid $mainSid) -band $writeMask) -eq 0 -and ((Get-AllowMask -Sddl $protectedState.egressSupervisorJournal -Sid $privilegedCommandSupervisorSid) -band $writeMask) -eq 0 -and ((Get-AllowMask -Sddl $protectedState.egressSupervisorJournalLock -Sid $privilegedCommandSupervisorSid) -band $writeMask) -eq 0 -and ((Get-AllowMask -Sddl $protectedState.egressSupervisorJournal -Sid $operatorSid) -band $writeMask) -eq 0 -and ((Get-AllowMask -Sddl $protectedState.egressSupervisorJournalLock -Sid $operatorSid) -band $writeMask) -eq 0) 'Non-owning principals can mutate an egress-supervisor lifecycle journal target.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.egressSupervisor -Sid $mainSid) -band $writeMask) -eq 0) 'Main companion can mutate the independent egress-supervisor lifecycle root.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.egressSupervisor -Sid $privilegedCommandSupervisorSid) -band $writeMask) -eq 0) 'Privileged-command supervisor can mutate the egress-supervisor lifecycle root.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.egressBoundary -Sid $egressSupervisorSid) -band $writeMask) -eq 0) 'Egress supervisor can mutate the companion-owned egress replay ledger.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.privilegedCommandSupervisor -Sid $privilegedCommandSupervisorSid) -band $writeMask) -ne 0) 'Privileged-command supervisor cannot mutate its own lifecycle root.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.privilegedCommandSupervisorJournal -Sid $privilegedCommandSupervisorSid) -band $writeMask) -ne 0 -and ((Get-AllowMask -Sddl $protectedState.privilegedCommandSupervisorJournalLock -Sid $privilegedCommandSupervisorSid) -band $writeMask) -ne 0) 'Privileged-command supervisor cannot own both lifecycle journal targets.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.privilegedCommandSupervisorJournal -Sid $mainSid) -band $writeMask) -eq 0 -and ((Get-AllowMask -Sddl $protectedState.privilegedCommandSupervisorJournalLock -Sid $mainSid) -band $writeMask) -eq 0 -and ((Get-AllowMask -Sddl $protectedState.privilegedCommandSupervisorJournal -Sid $egressSupervisorSid) -band $writeMask) -eq 0 -and ((Get-AllowMask -Sddl $protectedState.privilegedCommandSupervisorJournalLock -Sid $egressSupervisorSid) -band $writeMask) -eq 0 -and ((Get-AllowMask -Sddl $protectedState.privilegedCommandSupervisorJournal -Sid $operatorSid) -band $writeMask) -eq 0 -and ((Get-AllowMask -Sddl $protectedState.privilegedCommandSupervisorJournalLock -Sid $operatorSid) -band $writeMask) -eq 0) 'Non-owning principals can mutate a privileged-command-supervisor lifecycle journal target.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.privilegedCommandSupervisor -Sid $mainSid) -band $writeMask) -eq 0) 'Main companion can mutate the independent privileged-command supervisor lifecycle root.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.privilegedCommandSupervisor -Sid $egressSupervisorSid) -band $writeMask) -eq 0) 'Egress supervisor can mutate the privileged-command supervisor lifecycle root.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.privilegedCommandIsolation -Sid $privilegedCommandSupervisorSid) -band $writeMask) -eq 0) 'Privileged-command supervisor can mutate the companion-owned replay ledger.'
foreach ($supervisorSid in @($egressSupervisorSid, $privilegedCommandSupervisorSid)) {
    Assert-Condition (((Get-AllowMask -Sddl $protectedState.applicationVersions -Sid $supervisorSid) -band $writeMask) -eq 0) 'An enforcement supervisor can mutate autonomous-update payloads.'
    Assert-Condition (((Get-AllowMask -Sddl $protectedState.applicationState -Sid $supervisorSid) -band $writeMask) -eq 0) 'An enforcement supervisor can mutate autonomous-update state.'
}
Assert-Condition (((Get-AllowMask -Sddl $protectedState.recoveryVault -Sid $mainSid) -band $writeMask) -ne 0) 'Main service lacks recovery-vault mutation access.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.recoveryVault -Sid $recoverySid) -band $writeMask) -ne 0) 'Recovery supervisor lacks recovery-vault mutation access.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.secretVault -Sid $mainSid) -band $writeMask) -ne 0) 'Main service lacks secret-vault access.'
Assert-Condition ((Get-AllowMask -Sddl $protectedState.secretVault -Sid $egressSupervisorSid) -ne 0 -and
    ((Get-AllowMask -Sddl $protectedState.secretVault -Sid $egressSupervisorSid) -band $writeMask) -eq 0) 'Egress supervisor lacks read-only secret-vault access or can mutate provisioned credentials.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.secretProvisioning -Sid $mainSid) -band $writeMask) -ne 0) 'Main service lacks secret-provisioning audit access.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.secretProvisioning -Sid $operatorSid) -band $writeMask) -eq 0) 'Recovery operators can mutate the secret-provisioning audit.'
Assert-Condition ((Get-AllowMask -Sddl $protectedState.secretVault -Sid $recoverySid) -eq 0) 'Recovery supervisor can access the secret vault.'
Assert-Condition ((Get-AllowMask -Sddl $protectedState.secretVault -Sid $updateSid) -eq 0) 'Update supervisor can access the secret vault.'
Assert-Condition (((Get-AllowMask -Sddl $protectedState.auditSigner -Sid $auditSignerSid) -band $writeMask) -ne 0) 'Audit signer cannot append to its protected journal root.'
Assert-Condition ((Get-AllowMask -Sddl $protectedState.recoveryVault -Sid $auditSignerSid) -eq 0) 'Audit signer can access the recovery vault.'
Assert-Condition ((Get-AllowMask -Sddl $protectedState.secretVault -Sid $auditSignerSid) -eq 0) 'Audit signer can access the secret vault.'
Assert-Condition ((Get-AllowMask -Sddl $protectedState.supervisor -Sid $operatorSid) -ne 0) 'Recovery-operator group cannot operate the supervisor root.'
Assert-Condition ($protectedState.journalSentinel -and $protectedState.recoverySentinel) 'Pre-existing data sentinels were lost during install.'

foreach ($supervisorName in @('Itemba Msaidizi Update Supervisor', 'Itemba Msaidizi Recovery Supervisor', 'Itemba Msaidizi Audit Signer', 'Itemba Msaidizi Egress Supervisor', 'Itemba Msaidizi Privileged Command Supervisor')) {
    $sdOutput = & "$env:SystemRoot\System32\sc.exe" sdshow $supervisorName 2>&1
    Assert-Condition ($LASTEXITCODE -eq 0) "Could not query service DACL: $supervisorName"
    Assert-Condition (($sdOutput -join '') -notmatch [regex]::Escape($mainSid)) "Main service can control trusted supervisor: $supervisorName"
}
Add-PassedCheck -Id 'acl.trust-separation' -Summary 'Binary, journal, supervisor, privileged-command replay, recovery-vault, Companion-write/egress-read secret-vault, secret-provisioning audit, operator, and service DACL separation verified.' -Details @{ recoveryOperatorsSid = $operatorSid }

$programs = @{
    Companion = Join-Path $binaryRoot 'Service\Itemba.Msaidizi.Companion.Service.exe'
    Agent = $agentPath
    UpdateSupervisor = Join-Path $binaryRoot 'UpdateSupervisor\Itemba.Msaidizi.UpdateSupervisor.exe'
    RecoverySupervisor = Join-Path $binaryRoot 'RecoverySupervisor\Itemba.Msaidizi.RecoverySupervisor.exe'
    AuditSigner = Join-Path $binaryRoot 'AuditSigner\Itemba.Msaidizi.AuditSigner.exe'
    EgressSupervisor = Join-Path $binaryRoot 'EgressSupervisor\Itemba.Msaidizi.EgressSupervisor.exe'
    PrivilegedCommandSupervisor = Join-Path $binaryRoot 'PrivilegedCommandSupervisor\Itemba.Msaidizi.PrivilegedCommandSupervisor.exe'
}
foreach ($entry in $programs.GetEnumerator()) {
    $ruleName = "Itemba Msaidizi - Block inbound - $($entry.Key)"
    $rule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction Stop
    Assert-Condition (@($rule).Count -eq 1) "Expected exactly one firewall rule: $ruleName"
    Assert-Condition ($rule.Enabled -eq 'True' -and $rule.Direction -eq 'Inbound' -and $rule.Action -eq 'Block') "Firewall rule is not an enabled inbound block: $ruleName"
    $application = $rule | Get-NetFirewallApplicationFilter
    Assert-Condition ([IO.Path]::GetFullPath($application.Program) -eq [IO.Path]::GetFullPath($entry.Value)) "Firewall rule program mismatch: $ruleName"
    $matchingFilters = @(Get-NetFirewallApplicationFilter -PolicyStore ActiveStore | Where-Object {
        $_.Program -and [IO.Path]::GetFullPath($_.Program) -eq [IO.Path]::GetFullPath($entry.Value)
    })
    $otherRules = @($matchingFilters | ForEach-Object {
        Get-NetFirewallRule -AssociatedNetFirewallApplicationFilter $_
    } | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' -and $_.Enabled -eq 'True' })
    Assert-Condition ($otherRules.Count -eq 0) "An enabled inbound allow rule targets $($entry.Value)."
}
Add-PassedCheck -Id 'network.inbound-blocked' -Summary 'Seven exact-program inbound block rules exist and no enabled inbound allow rule targets a product executable.' -Details @{ ruleCount = 7 }

Start-Service -Name 'Itemba Msaidizi Companion' -ErrorAction Stop
$deadline = [DateTime]::UtcNow.AddSeconds(30)
do {
    Start-Sleep -Milliseconds 250
    $runningService = Get-CimInstance Win32_Service -Filter "Name='Itemba Msaidizi Companion'" -ErrorAction Stop
} while ($runningService.State -ne 'Running' -and [DateTime]::UtcNow -lt $deadline)
Assert-Condition ($runningService.State -eq 'Running' -and [int]$runningService.ProcessId -gt 0) 'Main service did not start in its fail-closed configuration.'
$tcpListeners = @(Get-NetTCPConnection -OwningProcess ([int]$runningService.ProcessId) -State Listen -ErrorAction SilentlyContinue)
$udpListeners = @(Get-NetUDPEndpoint -OwningProcess ([int]$runningService.ProcessId) -ErrorAction SilentlyContinue)
Assert-Condition ($tcpListeners.Count -eq 0 -and $udpListeners.Count -eq 0) 'Main service opened a local TCP or UDP listener.'
foreach ($enforcementService in @('Itemba Msaidizi Egress Supervisor', 'Itemba Msaidizi Privileged Command Supervisor')) {
    $enforcementRuntime = Get-CimInstance Win32_Service -Filter "Name='$($enforcementService.Replace("'", "''"))'" -ErrorAction Stop
    Assert-Condition ($enforcementRuntime.State -eq 'Running' -and [int]$enforcementRuntime.ProcessId -gt 0) "$enforcementService did not start as a companion dependency."
    $enforcementTcpListeners = @(Get-NetTCPConnection -OwningProcess ([int]$enforcementRuntime.ProcessId) -State Listen -ErrorAction SilentlyContinue)
    $enforcementUdpListeners = @(Get-NetUDPEndpoint -OwningProcess ([int]$enforcementRuntime.ProcessId) -ErrorAction SilentlyContinue)
    Assert-Condition ($enforcementTcpListeners.Count -eq 0 -and $enforcementUdpListeners.Count -eq 0) "$enforcementService opened a TCP or UDP listener in safe-off mode."
}
Stop-Service -Name 'Itemba Msaidizi Companion' -Force -ErrorAction Stop
Assert-Condition ((Get-Service -Name 'Itemba Msaidizi Update Supervisor').Status -eq 'Stopped') 'Update supervisor started without provisioning.'
Assert-Condition ((Get-Service -Name 'Itemba Msaidizi Recovery Supervisor').Status -eq 'Stopped') 'Recovery supervisor started without provisioning.'
Assert-Condition ((Get-Service -Name 'Itemba Msaidizi Audit Signer').Status -eq 'Stopped') 'Audit signer started without provisioning.'
Stop-Service -Name 'Itemba Msaidizi Egress Supervisor' -Force -ErrorAction Stop
Stop-Service -Name 'Itemba Msaidizi Privileged Command Supervisor' -Force -ErrorAction Stop
Add-PassedCheck -Id 'runtime.no-listener' -Summary 'Fail-closed companion and both automatic enforcement dependencies start without any TCP/UDP listener; unprovisioned demand supervisors remain stopped.' -Details @{ tcpListeners = 0; udpListeners = 0; enforcementSupervisors = 2 }

$preservedDeviceId = "VM-PRESERVED-$($runGuid.ToString('D'))"
$serviceConfigPath = Join-Path $dataRoot 'config\service\appsettings.json'
Invoke-SystemProbe -ProbeBody @"
`$path = '$($serviceConfigPath.Replace("'", "''"))'
`$config = Get-Content -LiteralPath `$path -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
`$config.Companion.DeviceId = '$preservedDeviceId'
`$json = `$config | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 30
[IO.File]::WriteAllText(`$path, `$json + [Environment]::NewLine, [Text.UTF8Encoding]::new(`$false))
[ordered]@{ deviceId = `$config.Companion.DeviceId }
"@ | Out-Null
$preservedConfigSha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $serviceConfigPath -Algorithm SHA256).Hash
Invoke-Msi -Operation uninstall -MsiPath $msiPath -LogPath $uninstallLog
foreach ($serviceName in $serviceNames) {
    Assert-Condition (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) "Service remains after uninstall: $serviceName"
}
Assert-Condition (-not (Test-Path -LiteralPath $binaryRoot)) 'Immutable product binary root remains after uninstall.'
Assert-Condition (-not ((Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run' -Name 'Itemba Msaidizi Agent' -ErrorAction SilentlyContinue).'Itemba Msaidizi Agent')) 'Agent startup remains after uninstall.'
foreach ($entry in $programs.GetEnumerator()) {
    Assert-Condition (-not (Get-NetFirewallRule -DisplayName "Itemba Msaidizi - Block inbound - $($entry.Key)" -ErrorAction SilentlyContinue)) "Firewall rule remains after uninstall: $($entry.Key)"
}
$postUninstallProbe = Invoke-SystemProbe -ProbeBody @"
[ordered]@{
  dataRoot = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))')
  serviceConfig = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\config\service\appsettings.json')
  agentConfig = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\config\agent\appsettings.json')
  updateConfig = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\config\update\appsettings.json')
  recoveryConfig = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\config\recovery\appsettings.json')
  auditSignerConfig = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\config\audit-signer\appsettings.json')
  egressSupervisorConfig = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\config\egress-supervisor\appsettings.json')
  privilegedCommandSupervisorConfig = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\config\privileged-command-supervisor\appsettings.json')
  journalSentinel = (Test-Path -LiteralPath '$($journalSentinel.Replace("'", "''"))')
  recoverySentinel = (Test-Path -LiteralPath '$($recoverySentinel.Replace("'", "''"))')
  configSentinel = (Test-Path -LiteralPath '$($configSentinel.Replace("'", "''"))')
  killSwitch = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\DISABLED')
  secretVault = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\secret-vault')
  secretProvisioning = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\secret-provisioning')
  recoveryVault = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\recovery-vault')
  egressSupervisorJournal = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\egress-supervisor\lifecycle.v2.jsonl')
  egressSupervisorJournalLock = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\egress-supervisor\lifecycle.v2.jsonl.lock')
  privilegedCommandSupervisorJournal = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\privileged-command-supervisor\lifecycle.v1.jsonl')
  privilegedCommandSupervisorJournalLock = (Test-Path -LiteralPath '$($dataRoot.Replace("'", "''"))\supervisor\privileged-command-supervisor\lifecycle.v1.jsonl.lock')
}
"@
foreach ($property in $postUninstallProbe.PSObject.Properties) {
    Assert-Condition ([bool]$property.Value) "Protected evidence/data was removed on uninstall: $($property.Name)"
}
Assert-Condition ((Get-LocalGroup -Name 'Itemba Msaidizi Recovery Operators' -ErrorAction SilentlyContinue) -ne $null) 'Recovery-operator group was deleted on uninstall.'
Add-PassedCheck -Id 'uninstall.preservation' -Summary 'Uninstall removed binaries/services/startup/firewall only and preserved all configs, journals, sentinels, supervisor roots, vaults, kill switch, and operator group.' -Details $postUninstallProbe

$reinstallLog = Join-Path $evidenceRoot "msi-reinstall-$($runGuid.ToString('N')).log"
$finalUninstallLog = Join-Path $evidenceRoot "msi-final-uninstall-$($runGuid.ToString('N')).log"
Invoke-Msi -Operation install -MsiPath $msiPath -LogPath $reinstallLog
Assert-Condition ((Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $serviceConfigPath -Algorithm SHA256).Hash -eq $preservedConfigSha256) 'Securely preserved service configuration was overwritten during reinstall.'
$reinstalledServiceConfig = Get-Content -LiteralPath $serviceConfigPath -Raw -Encoding utf8 | Microsoft.PowerShell.Utility\ConvertFrom-Json
Assert-Condition ($reinstalledServiceConfig.Companion.DeviceId -eq $preservedDeviceId) 'Securely preserved service configuration content changed during reinstall.'
foreach ($sentinel in @($journalSentinel, $recoverySentinel, $configSentinel)) {
    Assert-Condition (Test-Path -LiteralPath $sentinel) "A legitimate preserved sentinel was lost during reinstall: $sentinel"
}
Assert-Condition (Test-Path -LiteralPath (Join-Path $dataRoot 'config\.installer-provenance.v1.json')) 'Protected reinstall provenance marker is missing.'
Add-PassedCheck -Id 'reinstall.provenance-preservation' -Summary 'A protected marker authorized reinstall and retained exact operational config bytes plus data sentinels.' -Details @{
    serviceConfigSha256 = $preservedConfigSha256.ToLowerInvariant()
    preservedDeviceId = $preservedDeviceId
    sentinels = 3
}
Invoke-Msi -Operation uninstall -MsiPath $msiPath -LogPath $finalUninstallLog
foreach ($serviceName in $serviceNames) {
    Assert-Condition (-not (Get-Service -Name $serviceName -ErrorAction SilentlyContinue)) "Service remains after final uninstall: $serviceName"
}
Assert-Condition ((Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $serviceConfigPath -Algorithm SHA256).Hash -eq $preservedConfigSha256) 'Final uninstall changed protected preserved configuration.'

$completedAt = [DateTimeOffset]::UtcNow
$evidencePath = Join-Path $evidenceRoot "vm-acceptance-$($runGuid.ToString('D')).json"
$evidenceSignaturePath = "$evidencePath.p7s"
$evidence = [ordered]@{
    schemaVersion = 1
    status = 'PASS_PENDING_EXTERNAL_VM_DISPOSITION'
    evidenceScope = 'MSI_INSTALL_FAIL_CLOSED_BOOTSTRAP_AND_UNINSTALL_ONLY'
    productionDeploymentEligible = $false
    operationalCoverage = [ordered]@{
        status = 'NOT_EXECUTED'
        outstandingGates = @(
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
    releaseManifestSha256 = (Microsoft.PowerShell.Utility\Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()
    releaseVersion = [string]$manifest.version
    sourceRevision = [string]$manifest.sourceRevision
    msiSha256 = ([string]$manifest.msi.sha256).ToLowerInvariant()
    vm = [ordered]@{
        runId = $runGuid.ToString('D')
        provider = $VmProvider
        cleanTemplateId = $CleanTemplateId
        snapshotId = $SnapshotId
        localHypervisorEvidence = [bool]$computerSystem.HypervisorPresent
        disposition = 'PENDING_EXTERNAL_ORCHESTRATOR_ATTESTATION'
    }
    startedAtUtc = $script:startedAt.ToString('O')
    completedAtUtc = $completedAt.ToString('O')
    evidenceSignerThumbprint = $evidenceThumbprint
    noSkippedChecks = $true
    checks = $checks
}
$evidence | Microsoft.PowerShell.Utility\ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $evidencePath -Encoding utf8
New-DetachedSignature -ContentPath $evidencePath -Certificate $evidenceCertificate -SignaturePath $evidenceSignaturePath
Assert-DetachedSignature -ContentPath $evidencePath -SignaturePath $evidenceSignaturePath -ExpectedThumbprint $evidenceThumbprint

Write-Host "VM acceptance passed: $evidencePath"
Write-Host 'This is installer-only evidence, not operational companion or production deployment approval. Destroy/revert the VM and obtain the separate orchestrator disposition.'
[pscustomobject]@{
    EvidencePath = $evidencePath
    EvidenceSignaturePath = $evidenceSignaturePath
    Status = 'PASS_PENDING_EXTERNAL_VM_DISPOSITION'
}
