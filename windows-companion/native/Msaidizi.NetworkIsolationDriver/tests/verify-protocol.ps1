[CmdletBinding()]
param(
  [switch]$RequireWdk
)

$ErrorActionPreference = 'Stop'
$driverRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $driverRoot '..\..\..')).Path
$checks = 0

function Assert-Text {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Pattern,
    [Parameter(Mandatory)][string]$Name
  )
  $text = Get-Content -LiteralPath $Path -Raw
  if ($text -notmatch $Pattern) {
    throw "Contract check failed: $Name ($Path)"
  }
  $script:checks++
}

function Assert-NoText {
  param(
    [Parameter(Mandatory)][string]$Path,
    [Parameter(Mandatory)][string]$Pattern,
    [Parameter(Mandatory)][string]$Name
  )
  $text = Get-Content -LiteralPath $Path -Raw
  if ($text -match $Pattern) {
    throw "Contract check failed: $Name ($Path)"
  }
  $script:checks++
}

$header = Join-Path $driverRoot 'include\msaidizi_network_isolation_protocol.h'
$driver = Join-Path $driverRoot 'src\driver.c'
$policy = Join-Path $driverRoot 'src\policy.c'
$wfp = Join-Path $driverRoot 'src\wfp.c'
$project = Join-Path $driverRoot 'Msaidizi.NetworkIsolationDriver.vcxproj'
$inf = Join-Path $driverRoot 'Msaidizi.NetworkIsolationDriver.inf'
$readme = Join-Path $driverRoot 'README.md'
$client = Join-Path $repoRoot 'windows-companion\src\Msaidizi.PrivilegedCommandSupervisor\Enforcement\WindowsKernelIsolationDriverClient.cs'
$managedProtocol = Join-Path $repoRoot 'windows-companion\src\Msaidizi.PrivilegedCommandSupervisor\Enforcement\NetworkIsolationProtocolV3.cs'
$managedSession = Join-Path $repoRoot 'windows-companion\src\Msaidizi.PrivilegedCommandSupervisor\Enforcement\NetworkIsolationDriverSessionV3.cs'
$managedProcessLease = Join-Path $repoRoot 'windows-companion\src\Msaidizi.PrivilegedCommandSupervisor\Enforcement\WindowsPrivilegedCommandProcessLease.cs'
$serviceIdentity = Join-Path $repoRoot 'windows-companion\src\Msaidizi.PrivilegedCommandSupervisor\Security\SupervisorServiceIdentity.cs'

Assert-Text $client 'NetworkIsolationDriverSessionV3' 'resident client uses the binary v3 session'
Assert-Text $client 'UnavailableV3SignedDriverAttestationSource' 'unprovisioned signed attestation remains fail closed'
Assert-NoText $client '0x00222000|0x00222004|0x00222008|0x0022200C' 'resident client never dispatches legacy v2 IOCTLs'
Assert-Text $managedProtocol 'Version\s*=\s*3' 'managed codec pins protocol v3'
Assert-Text $managedProtocol 'IoctlGetProtocol\s*=\s*0x0022E040' 'managed GET_PROTOCOL IOCTL matches'
Assert-Text $managedProtocol 'IoctlGetHealth\s*=\s*0x0022E044' 'managed GET_HEALTH IOCTL matches'
Assert-Text $managedProtocol 'IoctlReplacePolicy\s*=\s*0x0022E048' 'managed REPLACE_POLICY IOCTL matches'
Assert-Text $managedProtocol 'IoctlEnrollProcess\s*=\s*0x0022E04C' 'managed ENROLL_PROCESS IOCTL matches'
Assert-Text $managedProtocol 'IoctlRemoveProcess\s*=\s*0x0022E050' 'managed REMOVE_PROCESS IOCTL matches'
Assert-Text $managedProtocol 'IoctlSetKillState\s*=\s*0x0022E054' 'managed SET_KILL_STATE IOCTL matches'
Assert-Text $managedProtocol 'BinaryPrimitives\.WriteUInt64LittleEndian' 'managed frames use explicit little endian writes'
Assert-Text $managedProtocol 'CryptographicOperations\.FixedTimeEquals' 'managed response identities use fixed-time comparisons'
Assert-Text $managedSession 'LastAcceptedRequestSequence' 'managed session resumes the driver sequence from health'
Assert-Text $managedSession 'StatusReplay' 'managed session fails closed on driver replay'
Assert-Text $managedProcessLease 'ProcessTelemetryIdInformation' 'managed enrollment obtains the kernel process start key'
Assert-Text $managedProcessLease 'FileShare\.Read' 'managed enrollment denies image writes and replacement while deriving identity'
Assert-Text $managedProcessLease 'RequireWfpApplicationIdMatches' 'managed enrollment binds path-derived WFP identity back to the locked image'
Assert-Text $managedProcessLease 'JobObjectLimitKillOnJobClose' 'supervisor owns an independent kill-on-close nested job'
Assert-Text $serviceIdentity 'RequiredServiceSid\s*=\s*\r?\n\s*"S-1-5-80-1792805186-3282615177-1795010573-3676175622-4117989893"' 'resident supervisor pins the same service SID'
Assert-Text $header 'MNI_LEGACY_JSON_PROTOCOL_VERSION\s+2u' 'shared ABI declares legacy version'
Assert-Text $header 'MNI_IOCTL_LEGACY_RECOVER\s+0x0022200cu' 'shared ABI pins legacy IOCTLs'

Assert-Text $driver 'IoCreateDeviceSecure' 'secure device creation is mandatory'
Assert-Text $driver 'MniApplySupervisorOnlyDeviceDacl' 'published device DACL is replaced before use'
Assert-Text $driver 'ZwSetSecurityObject\(deviceHandle, DACL_SECURITY_INFORMATION' 'device DACL is applied in kernel'
Assert-Text $driver '\{ 80, 1792805186, 3282615177, 1795010573, 3676175622, 4117989893 \}' 'device DACL uses exact supervisor service SID'
Assert-Text $driver 'MniRequestorIsSupervisor\(irp\)' 'create and IOCTL paths recheck caller service SID'
Assert-Text $driver 'TokenRestrictedSids' 'restricted service tokens are recognized'
Assert-Text $driver 'LEGACY_NOT_PROVISIONED' 'legacy lifecycle fails explicitly'
Assert-NoText $driver '\\"accepted\\":true' 'legacy lifecycle is never accepted'
Assert-Text $driver 'MniDispatchCleanup[\s\S]*MniLatchKillWithoutRequest' 'handle cleanup latches network kill'
Assert-Text $driver 'MniLatchKillWithoutRequest[\s\S]*~0ull' 'implicit kill generation saturates instead of wrapping'
Assert-Text $driver 'does not terminate existing sockets or process trees' 'source states cleanup boundary'
Assert-Text $driver 'immutable copy' 'METHOD_BUFFERED input is preserved before response writes'

Assert-Text $wfp 'FWPM_SESSION_FLAG_DYNAMIC' 'WFP objects use a dynamic session'
Assert-Text $wfp 'MniWfpManagementStatus[\s\S]*RtlNtStatusFromDosError' 'DWORD WFP management failures become NTSTATUS failures'
Assert-Text $wfp 'FWPM_LAYER_ALE_AUTH_CONNECT_V4' 'IPv4 ALE connect is covered'
Assert-Text $wfp 'FWPM_LAYER_ALE_AUTH_CONNECT_V6' 'IPv6 ALE connect is covered'
Assert-Text $wfp 'FWP_ACTION_BLOCK' 'denials block at ALE connect'
Assert-Text $wfp 'rights\s*&=\s*~FWPS_RIGHT_ACTION_WRITE' 'later filters cannot override a block'
Assert-Text $wfp 'PsSetCreateProcessNotifyRoutineEx' 'PID lifecycle notification is registered'
Assert-Text $wfp 'FwpmEngineClose0' 'dynamic policy owner is closed during teardown'

Assert-Text $policy 'EndpointKind == MNI_ENDPOINT_BROKER' 'broker endpoint kind is closed'
Assert-Text $policy 'EndpointKind == MNI_ENDPOINT_EGRESS_SUPERVISOR' 'egress endpoint kind is closed'
Assert-Text $policy 'RequestSequence <= \(UINT64\)InterlockedCompareExchange64' 'request sequence is monotonic'
Assert-Text $policy 'MniReplaySeenLocked' 'request ID replay is rejected'
Assert-Text $policy 'expectedType == MNI_MESSAGE_KILL_REQUEST[\s\S]*header->PolicyGeneration != 0' 'out-of-band kill is policy-generation independent'
Assert-Text $policy 'PsGetProcessCreateTimeQuadPart' 'process creation identity is checked'
Assert-Text $policy 'PsGetProcessStartKey' 'process start key is checked'
Assert-Text $policy 'record->Process != process' 'PID reuse is tied to process object identity'
Assert-Text $policy '!processTerminal[\s\S]*MNI_STATUS_ACCESS_DENIED' 'active processes cannot be unenrolled'
Assert-Text $policy 'StalePid = 2[\s\S]*MniLiveProcessObjectStillCurrent[\s\S]*InterlockedCompareExchange' 'enrollment remains blocked through PID-race revalidation'
Assert-Text $policy 'MniSwapPolicy\(replacement\)' 'policy snapshot replacement is atomic'
Assert-Text $policy 'ExpiresAtFileTime100ns <= now' 'expired authorization fails closed'

Assert-Text $project 'WindowsKernelModeDriver10.0' 'project requests the WDK toolset'
Assert-Text $project 'Fwpkclnt.lib;Wdmsec.lib;Cng.lib' 'kernel dependencies are explicit'
Assert-Text $inf 'StartType=3' 'driver install is demand-start only'
Assert-Text $inf 'PnpLockdown=1' 'driver package is locked down'
Assert-Text $readme 'does not close existing sockets' 'documentation states ALE limitation'
Assert-Text $readme 'does not terminate a process tree' 'documentation states lifecycle limitation'
Assert-Text $readme 'LEGACY_NOT_PROVISIONED' 'documentation states v2 compatibility status'
Assert-Text $readme 'not deployment evidence' 'documentation rejects readiness overclaim'

$serviceName = 'Itemba Msaidizi Privileged Command Supervisor'.ToUpperInvariant()
$sha1 = [Security.Cryptography.SHA1]::Create()
try {
  $serviceHash = $sha1.ComputeHash([Text.Encoding]::Unicode.GetBytes($serviceName))
} finally {
  $sha1.Dispose()
}
$subAuthorities = for ($offset = 0; $offset -lt 20; $offset += 4) {
  [BitConverter]::ToUInt32($serviceHash, $offset)
}
$derivedServiceSid = 'S-1-5-80-' + ($subAuthorities -join '-')
if ($derivedServiceSid -ne 'S-1-5-80-1792805186-3282615177-1795010573-3676175622-4117989893') {
  throw "Supervisor service SID derivation changed: $derivedServiceSid"
}
$checks++

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
  throw 'Visual Studio locator not found; portable ABI compilation was not run.'
}
$installation = (& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath | Select-Object -First 1)
if ([string]::IsNullOrWhiteSpace($installation)) {
  throw 'MSVC C++ tools not found; portable ABI compilation was not run.'
}
$developerShell = Join-Path $installation 'Common7\Tools\VsDevCmd.bat'
$contractTest = Join-Path $PSScriptRoot 'protocol_contract_tests.cpp'
$compileCommand = 'call "{0}" -no_logo -arch=x64 -host_arch=x64 >nul && cl.exe /nologo /std:c++20 /permissive- /W4 /WX /Zs "{1}"' -f $developerShell, $contractTest
& $env:ComSpec /d /s /c $compileCommand
if ($LASTEXITCODE -ne 0) {
  throw "Portable protocol ABI compilation failed with exit code $LASTEXITCODE."
}
$checks++

$kitsRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10'
$wdkHeader = Get-ChildItem -Path (Join-Path $kitsRoot 'Include\*\km\fwpsk.h') -ErrorAction SilentlyContinue | Select-Object -First 1
$wdkTargets = Get-ChildItem -Path (Join-Path $kitsRoot 'build\*\WindowsDriver.Common.targets') -ErrorAction SilentlyContinue | Select-Object -First 1
$wdkReady = $null -ne $wdkHeader -and $null -ne $wdkTargets
if ($RequireWdk -and -not $wdkReady) {
  throw 'A complete WDK installation was required but kernel headers/build targets are unavailable.'
}

Write-Host "Protocol/static checks passed: $checks"
if ($wdkReady) {
  Write-Host "WDK discovery: available at $kitsRoot (this script still does not sign or VM-load the driver)."
} else {
  Write-Host 'WDK discovery: unavailable; kernel build, signing, installation, and VM enforcement evidence remain pending.'
}
