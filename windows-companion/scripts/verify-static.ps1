[CmdletBinding()]
param(
  [switch]$RequireRoslyn
)

$ErrorActionPreference = 'Stop'
$companionRoot = Split-Path -Parent $PSScriptRoot
$problems = [System.Collections.Generic.List[string]]::new()

$generatedPathPattern = '[\\/](?:bin|obj)[\\/]'

function Assert-LiteralOrder {
  param(
    [Parameter(Mandatory)][string]$Source,
    [Parameter(Mandatory)][string]$Description,
    [Parameter(Mandatory)][string[]]$Literals
  )

  $cursor = -1
  foreach ($literal in $Literals) {
    $index = $Source.IndexOf(
      $literal,
      $cursor + 1,
      [StringComparison]::Ordinal)
    if ($index -lt 0) {
      $problems.Add("$Description is missing ordered stage $literal.")
      return
    }
    $cursor = $index
  }
}

Get-ChildItem -LiteralPath $companionRoot -Recurse -File -Filter '*.json' |
  Where-Object { $_.FullName -notmatch $generatedPathPattern } |
  ForEach-Object {
  $jsonFile = $_
  try {
    Get-Content -Raw -LiteralPath $jsonFile.FullName | ConvertFrom-Json | Out-Null
  }
  catch {
    $problems.Add("Invalid JSON: $($jsonFile.FullName): $($_.Exception.Message)")
  }
}

Get-ChildItem -LiteralPath $companionRoot -Recurse -File |
  Where-Object {
    $_.FullName -notmatch $generatedPathPattern `
      -and $_.Extension -in @('.csproj', '.props')
  } |
  ForEach-Object {
    $projectFile = $_
    try {
      $project = [xml](Get-Content -Raw -LiteralPath $projectFile.FullName)
      $projectReferences = @($project.SelectNodes(
          '/*[local-name()="Project"]/*[local-name()="ItemGroup"]/*[local-name()="ProjectReference"]'))
      foreach ($reference in $projectReferences) {
        $include = [string]$reference.GetAttribute('Include')
        if (-not [string]::IsNullOrWhiteSpace($include)) {
          $target = Join-Path $projectFile.DirectoryName $include
          if (-not (Test-Path -LiteralPath $target)) {
            $problems.Add("Missing ProjectReference: $target")
          }
        }
      }
    }
    catch {
      $problems.Add("Invalid project XML: $($projectFile.FullName): $($_.Exception.Message)")
    }
  }

$solutionPath = Join-Path $companionRoot 'Msaidizi.WindowsCompanion.sln'
$solution = Get-Content -LiteralPath $solutionPath
if ($solution[0] -ne 'Microsoft Visual Studio Solution File, Format Version 12.00') {
  $problems.Add('Invalid Visual Studio solution header.')
}

$solutionProjects = Select-String -Path $solutionPath `
  -Pattern '^Project\("[^"]+"\) = "[^"]+", "([^"]+)"' |
  ForEach-Object { $_.Matches[0].Groups[1].Value }
foreach ($solutionProject in $solutionProjects) {
  if (-not (Test-Path -LiteralPath (Join-Path $companionRoot $solutionProject))) {
    $problems.Add("Missing solution project: $solutionProject")
  }
}

$ownedProcessBoundary = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Capabilities\OwnedProcessManager.cs'
$ownedProcessTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\OwnedProcessCapabilityTests.cs'
$updateEvaluatorProcessBoundary = Join-Path $companionRoot `
  'src\Msaidizi.UpdateEvaluator\Evaluation\HyperVEvaluationProvider.cs'
$actionExecutionCoordinator = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Execution\ActionExecutionCoordinator.cs'
$actionTokenVerifier = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Contracts\Security\ActionTokenVerifier.cs'
$actionTokenVerifierTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\ActionTokenVerifierTests.cs'
$egressBoundaryVerification = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Security\EgressBoundaryVerification.cs'
$egressBoundaryContracts = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Contracts\Security\EgressBoundaryContracts.cs'
$egressBoundaryTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\EgressBoundaryContractTests.cs'
$egressSupervisorLifecycleContracts = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Contracts\Security\EgressSupervisorLifecycleContracts.cs'
$namedPipeEgressBoundaryClient = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Security\NamedPipeEgressBoundaryClient.cs'
$namedPipeEgressBoundaryTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\NamedPipeEgressBoundaryClientTests.cs'
$companionOptions = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Configuration\CompanionOptions.cs'
$externalActionAdapters = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Capabilities\ExternalActionCapabilityAdapters.cs'
$externalActionFlowTransport = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Capabilities\NamedPipeEgressSupervisorExternalActionTransport.cs'
$externalActionTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\ExternalActionCapabilityTests.cs'
$externalActionFlowTransportTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\EgressSupervisorExternalActionTransportTests.cs'
$trustedSupervisorProcessAccessGrant = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Security\TrustedSupervisorProcessAccessGrant.cs'
$restrictedServicePeerTokenValidator = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Security\RestrictedServicePeerTokenValidator.cs'
$actionJournal = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Journal\FileHashChainActionJournal.cs'
$journalReconciliationGate = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Journal\JournalReconciliationGate.cs'
$outboundCompanionChannel = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Channel\HttpPollingCompanionChannel.cs'
$sessionBridgeSecurityTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\SessionBridgeSecurityTests.cs'
$capabilityBoundaryContracts = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Contracts\Security\CapabilityBoundaryAttestationContracts.cs'
$capabilityBoundaryProvider = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Security\CapabilityBoundaryAttestationProvider.cs'
$sessionBridgeBoundary = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\SessionBridge\NamedPipeSessionBridge.cs'
$agentSessionBoundary = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Agent\Channel\NamedPipeAgentSessionChannel.cs'
$agentWorkerBoundary = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Agent\AgentWorker.cs'
$capabilityBoundaryTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\CapabilityBoundaryAttestationTests.cs'
$egressReplayStartupVerifier = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Security\EgressReceiptReplayStartupVerifier.cs'
$egressReplayRuntimeBoundary = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Security\EgressReplayRuntimeBoundary.cs'
$approvedBrowserBoundary = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Agent\Capabilities\ApprovedBrowserLauncher.cs'
$standardUserCommandBoundary = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Agent\Capabilities\StandardUserCommandCapabilityAdapter.cs'
$privilegedCommandBoundary = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Capabilities\PrivilegedCommandCapabilityAdapter.cs'
$privilegedCommandIsolationBoundary = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Capabilities\PrivilegedCommandTrustedRootIsolation.cs'
$privilegedCommandNamedPipeIsolationClient = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Capabilities\NamedPipePrivilegedCommandTrustedRootIsolationClient.cs'
$privilegedCommandIsolationKeyResolver = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Security\ExactPurposeP256PublicKeyResolver.cs'
$privilegedCommandIsolationContracts = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Contracts\Security\PrivilegedCommandIsolationContracts.cs'
$privilegedCommandIsolationReplayStore = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Security\PrivilegedCommandIsolationReplayStore.cs'
$privilegedCommandIsolationStartupReconciler = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Security\PrivilegedCommandIsolationStartupReconciler.cs'
$privilegedCommandTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\PrivilegedCommandCapabilityTests.cs'
$privilegedCommandIsolationTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\PrivilegedCommandIsolationContractTests.cs'
$privilegedCommandIsolationReplayStoreTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\PrivilegedCommandIsolationReplayStoreTests.cs'
$privilegedCommandNamedPipeIsolationClientTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\NamedPipePrivilegedCommandTrustedRootIsolationClientTests.cs'
$privilegedCommandIsolationClientFactoryTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\PrivilegedCommandIsolationClientFactoryTests.cs'
$actionExecutionCoordinatorTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\ActionExecutionCoordinatorTests.cs'
$governedSystemCommandBoundary = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Service\Capabilities\GovernedSystemToolRunner.cs'
$governedSystemCommandTests = Join-Path $companionRoot `
  'tests\Msaidizi.Companion.Tests\GovernedSystemToolRunnerTests.cs'
$egressSupervisorProgram = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\Program.cs'
$egressSupervisorIdentity = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\EgressSupervisorTrustIdentity.cs'
$egressSupervisorRegistration = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\EgressSupervisorServiceRegistration.cs'
$egressSupervisorEngine = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\Core\EgressSupervisorEngine.cs'
$egressSupervisorDestinationPolicy = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\Core\EgressDestinationPolicy.cs'
$egressSupervisorDataService = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\Transport\NamedPipeEgressDataService.cs'
$egressSupervisorExactRequestValidator = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\Transport\EgressExactHttpRequestValidator.cs'
$egressSupervisorPipeBoundary = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\Transport\AuthenticatedEgressPipe.cs'
$egressSupervisorPosture = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\Security\EgressHostPosture.cs'
$egressSupervisorSecretVault = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\Security\EgressSupervisorSecretVault.cs'
$egressSupervisorKillSwitch = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\Security\EgressTrustedKillSwitch.cs'
$egressSupervisorSigningKeys = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\Security\EgressSupervisorSigningKeys.cs'
$egressSupervisorProcessBoundary = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\Security\WindowsEgressProcessObjectBoundary.cs'
$egressSupervisorRestrictedToken = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\Security\RestrictedServiceTokenValidator.cs'
$egressSupervisorJournal = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\Persistence\DurableEgressJournal.cs'
$egressSupervisorJournalProtection = Join-Path $companionRoot `
  'src\Msaidizi.EgressSupervisor\Persistence\WindowsEgressJournalProtection.cs'
$egressSupervisorTests = Join-Path $companionRoot `
  'tests\Msaidizi.EgressSupervisor.Tests\EgressSupervisorEngineTests.cs'
$isolationSupervisorProgram = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Program.cs'
$isolationSupervisorOptions = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Configuration\PrivilegedCommandSupervisorOptions.cs'
$isolationSupervisorIdentity = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Security\SupervisorServiceIdentity.cs'
$isolationSupervisorPipeBoundary = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Channel\SecureIsolationPipe.cs'
$isolationSupervisorDriver = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Enforcement\WindowsKernelIsolationDriverClient.cs'
$isolationSupervisorV3Protocol = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Enforcement\NetworkIsolationProtocolV3.cs'
$isolationSupervisorV3Session = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Enforcement\NetworkIsolationDriverSessionV3.cs'
$isolationSupervisorV3Transport = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Enforcement\WindowsNetworkIsolationDeviceTransport.cs'
$isolationSupervisorV3ProcessLease = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Enforcement\WindowsPrivilegedCommandProcessLease.cs'
$isolationSupervisorV3Tests = Join-Path $companionRoot `
  'tests\Msaidizi.PrivilegedCommandSupervisor.Tests\NetworkIsolationProtocolV3Tests.cs'
$isolationSupervisorDriverContracts = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Enforcement\KernelIsolationContracts.cs'
$isolationSupervisorDriverAttestationValidator = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Enforcement\SignedDriverAttestationValidator.cs'
$isolationSupervisorEngine = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Execution\IsolationLifecycleEngine.cs'
$isolationSupervisorRuntimeMeasurement = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Security\RuntimeMeasurementVerifier.cs'
$isolationSupervisorHostPosture = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Security\WindowsIsolationHostPosture.cs'
$isolationSupervisorVerificationKeys = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Security\PinnedVerificationKeys.cs'
$isolationSupervisorSigner = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Security\IsolationEvidenceSigner.cs'
$isolationSupervisorProcessBoundary = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Security\ProcessIdentityAccessPolicy.cs'
$isolationSupervisorRestrictedToken = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Security\RestrictedServiceTokenValidator.cs'
$isolationSupervisorJournal = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\State\FileIsolationLifecycleStore.cs'
$isolationSupervisorJournalProtection = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\State\WindowsIsolationJournalProtection.cs'
$isolationSupervisorKillSwitch = Join-Path $companionRoot `
  'src\Msaidizi.PrivilegedCommandSupervisor\Supervision\TrustedKillSwitch.cs'
$isolationSupervisorTests = Join-Path $companionRoot `
  'tests\Msaidizi.PrivilegedCommandSupervisor.Tests\IsolationLifecycleEngineTests.cs'
$isolationSupervisorBoundaryTests = Join-Path $companionRoot `
  'tests\Msaidizi.PrivilegedCommandSupervisor.Tests\SupervisorBoundaryTests.cs'
$isolationSupervisorDriverAttestationTests = Join-Path $companionRoot `
  'tests\Msaidizi.PrivilegedCommandSupervisor.Tests\SignedDriverAttestationValidatorTests.cs'
$forbiddenPattern =
  'Process\.Start\s*\(|System\.Management\.Automation|Runspace|ShellExecute|WScript|CScript|' +
  'CreateProcess|\bcmd\.exe\b|\bpowershell\.exe\b|\bpwsh\.exe\b'
$forbiddenMatches = Get-ChildItem -LiteralPath $companionRoot -Recurse -File -Filter '*.cs' |
  Where-Object { $_.FullName -notmatch $generatedPathPattern } |
  Where-Object {
    $_.FullName -ne $ownedProcessBoundary `
      -and $_.FullName -ne $ownedProcessTests `
      -and $_.FullName -ne $approvedBrowserBoundary `
      -and $_.FullName -ne $standardUserCommandBoundary `
      -and $_.FullName -ne $privilegedCommandBoundary `
      -and $_.FullName -ne $privilegedCommandTests `
      -and $_.FullName -ne $privilegedCommandNamedPipeIsolationClientTests `
      -and $_.FullName -ne $isolationSupervisorEngine `
      -and $_.FullName -ne $isolationSupervisorTests `
      -and $_.FullName -ne $isolationSupervisorV3Tests `
      -and $_.FullName -ne $governedSystemCommandBoundary `
      -and $_.FullName -ne $governedSystemCommandTests `
      -and $_.FullName -ne $updateEvaluatorProcessBoundary
  } |
  Select-String -Pattern $forbiddenPattern -CaseSensitive:$false
foreach ($match in $forbiddenMatches) {
  $problems.Add("Forbidden arbitrary-execution API: $($match.Path):$($match.LineNumber)")
}

$updateEvaluatorProcessSource = Get-Content -Raw -LiteralPath $updateEvaluatorProcessBoundary
foreach ($requiredEvaluatorBoundary in @(
    'PowerShellExecutablePath',
    'ProviderScriptSha256',
    'ExecutionPolicy", "AllSigned',
    'UseShellExecute = false',
    'CreateNoWindow = true',
    'process.Kill(entireProcessTree: true)',
    'WorkspaceExportGuard.AssertRegularTree'
  )) {
  if ($updateEvaluatorProcessSource -notmatch [regex]::Escape($requiredEvaluatorBoundary)) {
    $problems.Add("Update evaluator process boundary is missing $requiredEvaluatorBoundary.")
  }
}
if ($updateEvaluatorProcessSource -match '(?i)cmd\.exe|/c|/k|ShellExecute\s*=\s*true') {
  $problems.Add('Update evaluator process boundary must use only its pinned signed provider script.')
}

$ownedProcessSource = Get-Content -Raw -LiteralPath $ownedProcessBoundary
foreach ($requiredBoundary in @(
    'CreateSuspended',
    'AssignProcessToJobObject',
    'JobObjectLimitKillOnJobClose',
    'JobObjectLimitJobTime',
    'JobObjectLimitActiveProcess',
    'JobObjectLimitJobMemory',
    'CreateUnicodeEnvironment',
    'BuildMinimalEnvironmentBlock',
    'OwnedProcessResourcePolicy',
    'ForbiddenExecutableNames',
    'BuildCommandLine'
  )) {
  if ($ownedProcessSource -notmatch [regex]::Escape($requiredBoundary)) {
    $problems.Add("Owned-process boundary is missing $requiredBoundary.")
  }
}
if ($ownedProcessSource -match 'Process\.Start|UseShellExecute|/c|/k') {
  $problems.Add('Owned-process boundary must not use a shell or Process.Start.')
}

$actionExecutionCoordinatorSource = Get-Content -Raw -LiteralPath $actionExecutionCoordinator
$actionTokenVerifierSource = Get-Content -Raw -LiteralPath $actionTokenVerifier
$actionTokenVerifierTestSource = Get-Content -Raw -LiteralPath $actionTokenVerifierTests
foreach ($requiredActionModeBoundary in @(
    'public required string ExecutionMode { get; init; }',
    'TryGetProperty("execution_mode", out _)',
    'ActionExecutionModes.IsSupported(claims.ExecutionMode)'
  )) {
  if ($actionTokenVerifierSource -notmatch
      [regex]::Escape($requiredActionModeBoundary)) {
    $problems.Add(
      "Signed action-token verifier is missing $requiredActionModeBoundary.")
  }
}
if ($actionTokenVerifierSource -match
    'ExecutionMode\s*\{\s*get;\s*init;\s*\}\s*=\s*ActionExecutionModes\.Execute') {
  $problems.Add(
    'An omitted signed execution mode must never default upward to EXECUTE.')
}
if ($actionTokenVerifierTestSource -notmatch
    [regex]::Escape('TokenWithoutExecutionModeCannotDefaultUpwardToExecute')) {
  $problems.Add(
    'Action-token tests must prove that missing execution_mode cannot grant execute authority.')
}
foreach ($requiredEgressPolicy in @(
    'StandardUserCapabilityCatalog.RequiresEgressBoundary',
    'PrivilegedCommandExecuteCapabilityAdapter.CapabilityId',
    'OwnedProcessLaunchCapabilityAdapter.CapabilityId',
    'MsiSoftwareInstallCapabilityAdapter.CapabilityId',
    'MsiSoftwareUninstallCapabilityAdapter.CapabilityId',
    'ScheduledTaskRunCapabilityAdapter.CapabilityId',
    'WindowsServiceStartCapabilityAdapter.CapabilityId',
    'ExternalActionCapabilityCatalog.All',
    'EgressBoundaryFeatures.CommandRequired'
  )) {
  if ($actionExecutionCoordinatorSource -notmatch [regex]::Escape($requiredEgressPolicy)) {
    $problems.Add("Action coordinator egress policy is missing $requiredEgressPolicy.")
  }
}
foreach ($requiredIsolationFence in @(
    '_isolationDispatchLatch.ThrowIfTripped()',
    'catch (PrivilegedCommandIsolationUnsafeException exception)',
    'ActionOutcome.NeedsAttention',
    'mutationCommitted: exception.MayHaveExecuted',
    'outcomeUncertain: true',
    '// Persist the durable ambiguity first, then fail the background worker',
    'throw;'
  )) {
  if ($actionExecutionCoordinatorSource -notmatch
      [regex]::Escape($requiredIsolationFence)) {
    $problems.Add("Action coordinator isolation fence is missing $requiredIsolationFence.")
  }
}
$isolationCatch = $actionExecutionCoordinatorSource.IndexOf(
  'catch (PrivilegedCommandIsolationUnsafeException exception)',
  [StringComparison]::Ordinal)
$hostPreconditionCatch = $actionExecutionCoordinatorSource.IndexOf(
  'catch (HostPreconditionException exception)',
  [StringComparison]::Ordinal)
if ($isolationCatch -lt 0 -or $hostPreconditionCatch -le $isolationCatch) {
  $problems.Add(
    'Isolation-unsafe failures must be handled before ordinary host preconditions so uncertainty cannot be downgraded.')
}

$egressBoundaryVerificationSource = Get-Content -Raw -LiteralPath $egressBoundaryVerification
$egressBoundaryContractSource = Get-Content -Raw -LiteralPath $egressBoundaryContracts
$egressBoundaryTestSource = Get-Content -Raw -LiteralPath $egressBoundaryTests
$egressSupervisorLifecycleContractSource = Get-Content -Raw -LiteralPath `
  $egressSupervisorLifecycleContracts
$namedPipeEgressBoundaryClientSource = Get-Content -Raw -LiteralPath `
  $namedPipeEgressBoundaryClient
$namedPipeEgressBoundaryTestSource = Get-Content -Raw -LiteralPath `
  $namedPipeEgressBoundaryTests
$companionOptionsSource = Get-Content -Raw -LiteralPath $companionOptions
$externalActionAdapterSource = Get-Content -Raw -LiteralPath $externalActionAdapters
$externalActionFlowTransportSource = Get-Content -Raw -LiteralPath `
  $externalActionFlowTransport
$externalActionTestSource = Get-Content -Raw -LiteralPath $externalActionTests
$externalActionFlowTransportTestSource = Get-Content -Raw -LiteralPath `
  $externalActionFlowTransportTests
$trustedSupervisorProcessAccessGrantSource = Get-Content -Raw -LiteralPath `
  $trustedSupervisorProcessAccessGrant
$actionExecutionCoordinatorTestSource = Get-Content -Raw -LiteralPath `
  $actionExecutionCoordinatorTests
$egressReplayStartupSource = Get-Content -Raw -LiteralPath $egressReplayStartupVerifier
$egressReplayRuntimeBoundarySource = Get-Content -Raw -LiteralPath `
  $egressReplayRuntimeBoundary
foreach ($requiredReplayBoundary in @(
    'Environment.ExpandEnvironmentVariables',
    'Path.IsPathFullyQualified',
    'StartsWith(@"\\?\",',
    'StartsWith(@"\\.\",',
    "relative.Contains(':', StringComparison.Ordinal)",
    'JsonUnmappedMemberHandling.Disallow',
    'MaximumLedgerBytes = 67_108_864',
    'MaximumLineCharacters = 16_384',
    'MaximumEntries = 200_000',
    '_ownershipLock = OpenOwnedFile($"{_path}.lock", openMode)',
    'requireInstallerBoundary ? FileMode.Open : FileMode.OpenOrCreate',
    'shareMode: 0x00000001',
    'flagsAndAttributes: 0x80200080',
    'GetReplayFileInformation(handle, out var information)',
    'information.NumberOfLinks != 1',
    'GetFinalReplayPath(handle)',
    'FileMode.Open => 3u',
    'Production egress replay state must use the exact installer-owned path.',
    'allowCreate: !_requireInstallerBoundary',
    'EgressReplayRuntimeBoundary.ValidateExactInstallerAcl(',
    '_ledger.Flush(flushToDisk: true)',
    'The egress receipt replay ledger has a partial record.',
    'EnsureDirectoryTreeHasNoReparsePoints',
    'JsonSerializer.Serialize(entry, SerializerOptions)',
    'PayloadDigest.FixedTimeEqualsHex(entry.EntrySha256, EntrySha256(entry))',
    '_actionIds.ContainsKey(actionId)',
    '_actionIds.Add(entry.ActionId, entry)',
    'Convert.ToBase64String(Encoding.UTF8.GetBytes(entry.ActionId))',
    'ValueTask InitializeAsync(CancellationToken cancellationToken)',
    'public sealed class EgressBoundaryDispatchLatch',
    'public void Trip() => Interlocked.Exchange(ref _tripped, 1)',
    'internal sealed class EgressBoundaryUnsafeException',
    'dispatchLatch.ThrowIfTripped()',
    'egress_receipt_replay_conflict',
    'egress_receipt_replay_unavailable',
    'dispatchLatch.Trip()'
  )) {
  if ($egressBoundaryVerificationSource -notmatch [regex]::Escape($requiredReplayBoundary)) {
    $problems.Add("Egress replay path boundary is missing $requiredReplayBoundary.")
  }
}
foreach ($requiredReplayTest in @(
    'CommandEffectsRejectBrowserFeatureSupersets',
    'ReplayLedgerSurvivesRestartAllowsExactIdempotencyAndRejectsConflicts',
    'ReplayLedgerRejectsSameActionIdentityWithFreshReceiptAndLease',
    'ReplayLedgerRejectsConcurrentOwnerAndMalformedRestartState',
    'ReplayLedgerRejectsHashTamperAndUnknownJsonFields',
    'ReplayLedgerExpandsTheDeploymentOwnedProgramDataStylePath',
    'ReplayLedgerRejectsNonlocalDeviceAndAlternateDataStreamPaths',
    'ReplayLedgerRejectsReparsePointAncestorWithoutWritingTarget',
    'ReplayLedgerRejectsHardLinkedLedgerFile',
    'ReplayLedgerPinsSingleLinkIdentityAgainstReplacementRace',
    'ProductionReplayLedgerCannotBeRedirectedFromTheInstallerOwnedPath',
    'ReplayStartupRejectsPartialStateAndTripsTheOneWayDispatchLatch',
    'ReceiptReplayStorageFailureTripsTheLatchAndSurfacesFatalAmbiguity',
    'InvalidPostExecutionReceiptTripsTheLatchBeforeFurtherDispatch',
    'MSAIDIZI_TEST_EGRESS_LEDGER_ROOT'
  )) {
  if ($egressBoundaryTestSource -notmatch [regex]::Escape($requiredReplayTest)) {
    $problems.Add("Egress replay path tests are missing $requiredReplayTest.")
  }
}
foreach ($requiredRuntimeBoundary in @(
    'CompanionServiceName = "Itemba Msaidizi Companion"',
    'RecoveryOperatorsGroup = "Itemba Msaidizi Recovery Operators"',
    'AccessControlSections.Owner | AccessControlSections.Access',
    'security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false)',
    'security.SetOwner(SystemSid)',
    'FileSystemRights.FullControl',
    'FileSystemRights.Modify',
    'FileSystemRights.ReadAndExecute',
    'ControlFlags.DiscretionaryAclProtected',
    'actualRaw.GetSddlForm(AccessControlSections.Access)'
  )) {
  if ($egressReplayRuntimeBoundarySource -notmatch
      [regex]::Escape($requiredRuntimeBoundary)) {
    $problems.Add("Egress runtime ACL boundary is missing $requiredRuntimeBoundary.")
  }
}
foreach ($requiredContractParity in @(
    'public const int ContractVersion = 4',
    'string ReservationDnsAnswerSetSha256',
    'string ConnectionDnsAnswerSetSha256',
    'string SelectedAddressSha256',
    'string RegistrationSha256',
    'string DispositionSha256',
    'Field(value.RegistrationSha256)',
    'Field(value.DispositionSha256)',
    'CanonicalSha256(value.RegistrationSha256)',
    'CanonicalSha256(value.DispositionSha256)',
    'expected.Length == actual.Count',
    'actual.SequenceEqual(expected, StringComparer.Ordinal)',
    'EgressBoundaryCanonical.IsExactP256(key)',
    'parameters.Curve.Oid.Value',
    'ECCurve.NamedCurves.nistP256.Oid.Value',
    '&& IsExactP256(key)',
    'if (!IsExactP256(key))'
  )) {
  if ($egressBoundaryContractSource -notmatch [regex]::Escape($requiredContractParity)) {
    $problems.Add("Egress contract parity is missing $requiredContractParity.")
  }
}
foreach ($requiredLifecycleBoundary in @(
    'EgressSupervisorLifecycleCanonical.RegistrationSha256',
    'EgressSupervisorLifecycleCanonical.DispositionSha256',
    'Exact(authorization.Attestation.KeyId, _options.AttestationKeyId)',
    'now.ToUnixTimeMilliseconds() < lease.ExpiresAtUnixMilliseconds',
    'receipt.RegistrationSha256',
    'receipt.DispositionSha256'
  )) {
  if ($namedPipeEgressBoundaryClientSource -notmatch
      [regex]::Escape($requiredLifecycleBoundary)) {
    $problems.Add("Named-pipe egress lifecycle is missing $requiredLifecycleBoundary.")
  }
}
foreach ($requiredEgressPeerBoundary in @(
    'EgressSupervisorClientOptions.RequiredSupervisorServiceSid',
    'ProcessQueryInformation | Synchronize',
    'RestrictedServicePeerTokenValidator.IsExactRestrictedService(',
    'ProcessImageFileMapping',
    'GetFinalPath(handle)',
    'information.NumberOfLinks != 1'
  )) {
  if ($namedPipeEgressBoundaryClientSource -notmatch
      [regex]::Escape($requiredEgressPeerBoundary)) {
    $problems.Add(
      "Egress supervisor pipe peer authentication is missing $requiredEgressPeerBoundary.")
  }
}
if ($companionOptionsSource -notmatch [regex]::Escape(
    'S-1-5-80-2691216044-51290016-1044150087-1430489630-3303720160')) {
  $problems.Add('The compiled egress supervisor service SID is not exact.')
}
foreach ($requiredLifecycleContract in @(
    'public const string Unknown = "unknown"',
    'public const string DirectRegistration = "direct"',
    'public static string RegistrationSha256',
    'public static string DispositionSha256',
    'ToLowerInvariant()'
  )) {
  if ($egressSupervisorLifecycleContractSource -notmatch
      [regex]::Escape($requiredLifecycleContract)) {
    $problems.Add("Egress lifecycle contract is missing $requiredLifecycleContract.")
  }
}
foreach ($requiredFailClosedAdapterBoundary in @(
    'ExternalActionCapabilityAdapter(',
    ') : IEgressLifecycleCapabilityAdapter',
    'throw new HostPreconditionException("egress_supervisor_flow_handle_required")',
    'adapter is not IEgressLifecycleCapabilityAdapter',
    '"egress_lifecycle_adapter_required"'
  )) {
  $source = if ($requiredFailClosedAdapterBoundary -like 'adapter*' `
      -or $requiredFailClosedAdapterBoundary -like '"egress*') {
    $actionExecutionCoordinatorSource
  }
  else {
    $externalActionAdapterSource
  }
  if ($source -notmatch [regex]::Escape($requiredFailClosedAdapterBoundary)) {
    $problems.Add(
      "External-action fail-closed boundary is missing $requiredFailClosedAdapterBoundary.")
  }
}
if ($externalActionAdapterSource -notmatch
    'ExternalActionCapabilityAdapter\([^)]*\)\s*:\s*IEgressLifecycleCapabilityAdapter') {
  $problems.Add(
    'Shipped external-action adapters must use the measured egress lifecycle and supervisor-owned flow transport.')
}
foreach ($requiredLifecycleRegression in @(
    'RuntimeRejectsAuthorizationFromANonPinnedAttestationKey',
    'RegistrationAcknowledgementReceivedAfterLeaseExpiryFailsClosed',
    'SignedReceiptMustBindExactRegistrationAndDisposition',
    'DirectExecutionWithoutLifecycleSessionFailsBeforeSecretOrNetwork',
    'SupervisorMayDowngradeCompletedAdapterToUnknownWithoutLosingReceipt'
  )) {
  if ($namedPipeEgressBoundaryTestSource -notmatch [regex]::Escape($requiredLifecycleRegression) `
      -and $externalActionTestSource -notmatch [regex]::Escape($requiredLifecycleRegression) `
      -and $actionExecutionCoordinatorTestSource -notmatch `
        [regex]::Escape($requiredLifecycleRegression)) {
    $problems.Add("Egress lifecycle regressions are missing $requiredLifecycleRegression.")
  }
}

foreach ($requiredFlowTransportBoundary in @(
    'public sealed class RejectingExternalActionTransport',
    'new HostPreconditionException("egress_supervisor_flow_transport_unconfigured")',
    'public sealed class NamedPipeEgressSupervisorExternalActionTransport',
    'string.Equals(control.PipeName, flow.PipeName, StringComparison.Ordinal)',
    'EgressSupervisorClientOptions.RequiredSupervisorServiceSid',
    'new WindowsEgressSupervisorPipeConnector()',
    'leaseRemaining',
    'CreateLinkedTokenSource(cancellationToken)',
    'new EgressFlowOpenRequestV1(',
    'flowBinding.ConnectionNonce.Span',
    'CryptographicOperations.ZeroMemory(claimBytes)',
    'response.ContractVersion != EgressSupervisorLifecycleContract.Version',
    '!response.Accepted',
    'connection.ThrowIfUnavailable()',
    'await connection.WriteFrameAsync(requestBytes, operation.Token)',
    'EgressFlowTransferResponseV1',
    'transfer.MeasuredExternalEgressBytes',
    'flowBinding.MaximumExternalEgressBytes'
  )) {
  if ($externalActionFlowTransportSource -notmatch
      [regex]::Escape($requiredFlowTransportBoundary)) {
    $problems.Add(
      "Supervisor-owned external-action flow transport is missing $requiredFlowTransportBoundary.")
  }
}
if ($externalActionFlowTransportSource -cmatch
    '\b(?:SslStream|TcpClient|Socket|HttpClient)\b') {
  $problems.Add(
    'The companion external-action transport must own neither TLS nor an Internet client.')
}
if ($externalActionAdapterSource -match
      '\bnew\s+(?:TcpClient|Socket|HttpClient)\b|using\s+System\.Net\.(?:Sockets|Http)' `
    -or $externalActionFlowTransportSource -match
      '\bnew\s+(?:TcpClient|Socket|HttpClient)\b|using\s+System\.Net\.(?:Sockets|Http)') {
  $problems.Add(
    'The companion external-action path must not own an Internet socket or HTTP client.')
}
Assert-LiteralOrder -Source $externalActionFlowTransportSource `
  -Description 'Supervisor flow claim precedes the exact framed request and measured result' -Literals @(
    'await connection.WriteFrameAsync(claimBytes, operation.Token)',
    'if (response.ContractVersion != EgressSupervisorLifecycleContract.Version',
    'connection.ThrowIfUnavailable()',
    'await connection.WriteFrameAsync(requestBytes, operation.Token)',
    'JsonSerializer.Deserialize<EgressFlowTransferResponseV1>',
    'transfer.MeasuredExternalEgressBytes',
    'return new ExternalActionTransportResult('
  )
foreach ($requiredFlowTransportRegression in @(
    'DisabledFlowClientReturnsNonAcceptingTransport',
    'ActiveFactoryRequiresDistinctExactControlAndDataPipes',
    'ActiveFactoryRejectsAnotherCanonicalRestrictedServiceSid',
    'RefusedFlowSendsExactOneTimeClaimWithoutOpeningTls',
    'AcceptedFlowRelaysOnlyExactFramedRequestAndSupervisorMeasurement',
    'PipeConnectOverallAndLeaseDeadlinesCancelSlowPaths',
    'FlowBindingZeroesNonceOnDispose'
  )) {
  if ($externalActionFlowTransportTestSource -notmatch
      [regex]::Escape($requiredFlowTransportRegression)) {
    $problems.Add(
      "Supervisor-owned flow transport tests are missing $requiredFlowTransportRegression.")
  }
}
foreach ($requiredProcessGrantBoundary in @(
    'SupervisorProcessAccessMask =',
    'SetSecurityInfo(',
    'GetEffectiveRightsFromAcl(',
    'effectiveRights != expected',
    'parts.Length == 9',
    'parts.Skip(4).Any('
  )) {
  if ($trustedSupervisorProcessAccessGrantSource -notmatch
      [regex]::Escape($requiredProcessGrantBoundary)) {
    $problems.Add(
      "Companion reciprocal supervisor process grant is missing $requiredProcessGrantBoundary.")
  }
}
foreach ($requiredStartupFence in @(
    'IEgressReceiptReplayStore replayStore',
    'EgressBoundaryDispatchLatch dispatchLatch',
    'await replayStore.InitializeAsync(cancellationToken)',
    'dispatchLatch.Trip()',
    'throw;'
  )) {
  if ($egressReplayStartupSource -notmatch [regex]::Escape($requiredStartupFence)) {
    $problems.Add("Egress replay startup fence is missing $requiredStartupFence.")
  }
}
foreach ($requiredCoordinatorFence in @(
    'if (requiresEgressBoundary)',
    '_egressDispatchLatch.ThrowIfTripped()',
    '_egressDispatchLatch.Trip()',
    '"egress_terminal_receipt_missing"',
    '"egress_receipt_measurement_mismatch"',
    '"cancelled_egress_outcome_unknown"',
    '"capability_egress_outcome_unknown"',
    'catch (EgressBoundaryUnsafeException exception)',
    'exception.MayHaveExecuted ? ActionOutcome.NeedsAttention : ActionOutcome.Failed',
    '// Persist ambiguity before stopping the worker.',
    'throw;'
  )) {
  if ($actionExecutionCoordinatorSource -notmatch
      [regex]::Escape($requiredCoordinatorFence)) {
    $problems.Add("Action coordinator egress fuse is missing $requiredCoordinatorFence.")
  }
}
$egressUnsafeCatch = $actionExecutionCoordinatorSource.IndexOf(
  'catch (EgressBoundaryUnsafeException exception)',
  [StringComparison]::Ordinal)
if ($egressUnsafeCatch -lt 0 -or $hostPreconditionCatch -le $egressUnsafeCatch) {
  $problems.Add(
    'Egress replay failures must be handled before ordinary host preconditions so ambiguity stops broker intake.')
}
if ($egressBoundaryVerificationSource -match
    '\bFileMode\.(?:Create|CreateNew|Truncate)\b|\bFile\.(?:WriteAllText|WriteAllBytes)\s*\(') {
  $problems.Add(
    'Egress replay evidence must use only its append-and-flush ledger path.')
}

$actionJournalSource = Get-Content -Raw -LiteralPath $actionJournal
$journalReconciliationGateSource = Get-Content -Raw -LiteralPath $journalReconciliationGate
$outboundCompanionChannelSource = Get-Content -Raw -LiteralPath $outboundCompanionChannel
foreach ($requiredJournalBoundary in @(
    'journal_hash_version_downgrade',
    'journal_chain_upgrade_missing',
    'record.Kind != JournalEntryKind.ChainUpgraded',
    'previousHashVersion != LegacyHashVersion',
    '_records.AddRange(loaded.Records)',
    '_records.Add(record)'
  )) {
  if ($actionJournalSource -notmatch [regex]::Escape($requiredJournalBoundary)) {
    $problems.Add("Action journal upgrade/cache boundary is missing $requiredJournalBoundary.")
  }
}
$upgradeIndex = $actionJournalSource.IndexOf(
  'JournalEntryKind.ChainUpgraded,',
  [StringComparison]::Ordinal)
$restartTerminalIndex = $actionJournalSource.IndexOf(
  'foreach (var active in loaded.ActivePreparations)',
  [StringComparison]::Ordinal)
if ($upgradeIndex -lt 0 -or $restartTerminalIndex -le $upgradeIndex) {
  $problems.Add(
    'A legacy journal must append its v2 bridge before any restart uncertainty terminal.')
}
$readRangeStart = $actionJournalSource.IndexOf(
  'public async ValueTask<JournalRecordRange> ReadRangeAsync',
  [StringComparison]::Ordinal)
$verifyStart = $actionJournalSource.IndexOf(
  'public async ValueTask<JournalVerificationResult> VerifyAsync',
  [StringComparison]::Ordinal)
if ($readRangeStart -lt 0 -or $verifyStart -le $readRangeStart `
    -or $actionJournalSource.Substring(
      $readRangeStart,
      $verifyStart - $readRangeStart) -match 'LoadAndVerify') {
  $problems.Add(
    'Journal range reads must use the startup-verified in-memory index rather than rescan the file.')
}
foreach ($requiredReconciliationBoundary in @(
    'GetJournalHeadAsync',
    'The central journal head does not exist in the verified local chain.',
    'while (true)',
    'Journal reconciliation did not make monotonic progress.',
    '"journal-head"',
    '"journal-reconcile"'
  )) {
  if ($journalReconciliationGateSource -notmatch
      [regex]::Escape($requiredReconciliationBoundary) `
      -and $outboundCompanionChannelSource -notmatch
      [regex]::Escape($requiredReconciliationBoundary)) {
    $problems.Add(
      "Journal central-cursor reconciliation is missing $requiredReconciliationBoundary.")
  }
}
if ($journalReconciliationGateSource -match '4_096') {
  $problems.Add('Journal reconciliation must not contain a fixed lifetime record ceiling.')
}

$browserBoundarySource = Get-Content -Raw -LiteralPath $approvedBrowserBoundary
foreach ($requiredBoundary in @(
    'ResolveBrowserUri',
    'UseShellExecute = true',
    'Verb = "open"'
  )) {
  if ($browserBoundarySource -notmatch [regex]::Escape($requiredBoundary)) {
    $problems.Add("Approved-browser boundary is missing $requiredBoundary.")
  }
}

$standardUserCatalog = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Contracts\Capabilities\StandardUserCapabilityCatalog.cs'
$standardUserValidator = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Contracts\Capabilities\StandardUserCapabilityContractValidator.cs'
$browserGovernedActions = Join-Path $companionRoot `
  'src\Msaidizi.Companion.Agent\Capabilities\BrowserGovernedActionCapabilityAdapters.cs'
$standardUserCatalogSource = Get-Content -Raw -LiteralPath $standardUserCatalog
$standardUserValidatorSource = Get-Content -Raw -LiteralPath $standardUserValidator
$browserGovernedActionsSource = Get-Content -Raw -LiteralPath $browserGovernedActions
$sessionBridgeSecurityTestSource = Get-Content -Raw -LiteralPath $sessionBridgeSecurityTests
foreach ($requiredBrowserTextBoundary in @(
    'browser.form.text.set',
    'BrowserFormTextSet.Id',
    'Credentials and other restricted values must use an ephemeral reference capability instead.'
  )) {
  if ($standardUserCatalogSource -notmatch [regex]::Escape($requiredBrowserTextBoundary)) {
    $problems.Add("Standard-user catalog is missing browser text boundary $requiredBrowserTextBoundary.")
  }
}
foreach ($requiredBrowserTextValidation in @(
    'ValidateBrowserText(arguments)',
    'contentClass',
    '"public" or "internal"',
    '!arguments.GetProperty("text").GetString()!.Contains(''\0'')'
  )) {
  if ($standardUserValidatorSource -notmatch [regex]::Escape($requiredBrowserTextValidation)) {
    $problems.Add("Standard-user validator is missing browser text boundary $requiredBrowserTextValidation.")
  }
}
foreach ($requiredBrowserTextExecution in @(
    'BrowserFormTextSetCapabilityAdapter',
    'context.ExpectedPreStateSha256',
    'targets.ValidateBrowserOriginDigest',
    'UiAutomationSupport.SetValueForeground',
    'OutcomeUncertain: true'
  )) {
  if ($browserGovernedActionsSource -notmatch [regex]::Escape($requiredBrowserTextExecution)) {
    $problems.Add("Browser text adapter is missing governed execution boundary $requiredBrowserTextExecution.")
  }
}
foreach ($requiredBrowserTextRegression in @(
    'BrowserTextContractIsBoundedClassifiedAndNeverReturnsPlaintext',
    'credentialClass.RootElement',
    'StandardUserCapabilityCatalog.RequiresEgressBoundary'
  )) {
  if ($sessionBridgeSecurityTestSource -notmatch
      [regex]::Escape($requiredBrowserTextRegression)) {
    $problems.Add("Browser text regression coverage is missing $requiredBrowserTextRegression.")
  }
}

$capabilityBoundaryContractSource = Get-Content -Raw -LiteralPath `
  $capabilityBoundaryContracts
$capabilityBoundaryProviderSource = Get-Content -Raw -LiteralPath `
  $capabilityBoundaryProvider
$sessionBridgeBoundarySource = Get-Content -Raw -LiteralPath $sessionBridgeBoundary
$agentSessionBoundarySource = Get-Content -Raw -LiteralPath $agentSessionBoundary
$agentWorkerBoundarySource = Get-Content -Raw -LiteralPath $agentWorkerBoundary
$capabilityBoundaryTestSource = Get-Content -Raw -LiteralPath $capabilityBoundaryTests
foreach ($requiredActivationContract in @(
    'standard-user-capability-activation-v1',
    'RequestNonceSha256',
    'SubjectProcessCreationTimeUnixMilliseconds',
    'CapabilityManifestSha256',
    'DestinationPolicySha256',
    'SupervisorPipeSecuritySha256',
    'ICapabilityBoundaryAttestationReplayGuard'
  )) {
  if ($capabilityBoundaryContractSource -notmatch
      [regex]::Escape($requiredActivationContract)) {
    $problems.Add("Capability activation contract is missing $requiredActivationContract.")
  }
}
foreach ($requiredProviderBoundary in @(
    'TryAttestCapabilitiesAsync',
    'ExpectedSupervisorPipeSecuritySha256',
    'CapabilityBoundaryAttestationExpectation',
    'EgressBoundaryFeatures.RequiredFor'
  )) {
  if ($capabilityBoundaryProviderSource -notmatch
      [regex]::Escape($requiredProviderBoundary)) {
    $problems.Add("Capability activation provider is missing $requiredProviderBoundary.")
  }
}
Assert-LiteralOrder -Source $agentSessionBoundarySource `
  -Description 'Agent capability activation authentication' -Literals @(
    'signingKey.VerifyData(',
    'VerifyCapabilityBoundaryAttestation(',
    'CapabilityBoundaryAttestationExpectation('
  )
foreach ($requiredSessionActivation in @(
    'ICapabilityBoundaryAttestationProvider',
    'SessionAgentRole',
    'actualProcessCreationTimeUnixMilliseconds',
    'capabilityBoundaryAttestation?.SignedAttestation',
    '_capabilityBoundaryAttestation?.IsFresh'
  )) {
  if ($sessionBridgeBoundarySource -notmatch
      [regex]::Escape($requiredSessionActivation)) {
    $problems.Add("Session bridge capability activation is missing $requiredSessionActivation.")
  }
}
foreach ($requiredAgentActivation in @(
    'channel.CapabilityBoundaryAttestation',
    'StandardUserCapabilityCatalog.SelectEnabled(',
    'connection.CancelAfter(remaining)',
    'session_capability_boundary_unavailable'
  )) {
  if ($agentWorkerBoundarySource -notmatch
      [regex]::Escape($requiredAgentActivation)) {
    $problems.Add("Agent capability activation is missing $requiredAgentActivation.")
  }
}
foreach ($requiredActivationRegression in @(
    'FreshPurposeBoundCommandEvidenceEnablesOnlyRequestedSurface',
    'StaleMismatchedAndReplayedEvidenceFailsClosed',
    'BothEffectsBindTheSortedFeatureUnionAndRequireBrowserEvidence',
    'EmergencyActivationCannotOmitCommandFeatures',
    'ServiceActivationStateWithdrawsOnExpiryOrSupervisorLoss'
  )) {
  if ($capabilityBoundaryTestSource -notmatch
      [regex]::Escape($requiredActivationRegression)) {
    $problems.Add("Capability activation regressions are missing $requiredActivationRegression.")
  }
}
if ($agentWorkerBoundarySource -notmatch 'session_capability_boundary_unavailable' -or
    (Get-Content -Raw -LiteralPath (Join-Path $companionRoot `
      'src\Msaidizi.Companion.Service\Channel\CapabilityManifestPublisher.cs')) `
      -notmatch 'PublishChangesAsync') {
  $problems.Add('Runtime activation withdrawal must reject execution and republish the manifest.')
}

$standardUserCommandSource = Get-Content -Raw -LiteralPath $standardUserCommandBoundary
foreach ($requiredBoundary in @(
    'CreateSuspended',
    'AssignProcessToJobObject',
    'JobObjectLimitKillOnJobClose',
    'ProcThreadAttributeHandleList',
    'BuildCommandLine',
    'MaximumCommandOutputBytes',
    'ProtectedSupervisorPaths',
    'OutcomeUncertain: true'
  )) {
  if ($standardUserCommandSource -notmatch [regex]::Escape($requiredBoundary)) {
    $problems.Add("Standard-user command boundary is missing $requiredBoundary.")
  }
}
if ($standardUserCommandSource -match 'UseShellExecute\s*=\s*true|System\.Management\.Automation|Runspace') {
  $problems.Add('Standard-user command boundary must use the native exact-argv path only.')
}

$privilegedCommandSource = Get-Content -Raw -LiteralPath $privilegedCommandBoundary
foreach ($requiredBoundary in @(
    'command.privileged.execute',
    'CreateSuspended',
    'ExtendedStartupInfoPresent',
    'JobObjectLimitKillOnJobClose',
    'ProcThreadAttributeHandleList',
    'ProcThreadAttributeJobList',
    'IsProcessInJob',
    'BuildCommandLine',
    'MaximumOutputBytes',
    'command_trusted_root_reference_forbidden',
    'EnsureSpecificationMatchesPolicy',
    'command_resolved_specification_invalid',
    'BuildIsolationBinding',
    'TryReserveAsync',
    'ReservationMatches',
    'CommitReservationAsync',
    'CreateProcessWithAudit',
    'CreateProcessNative',
    'TryBindSuspendedProcessAsync',
    'BindMatches',
    'CommitBindAcknowledgementAsync',
    'TryReleaseBeforeBindAsync',
    'CommitPreBindReleaseAsync',
    'TrySettleAsync',
    'TerminalReceiptMatches',
    'CommitTerminalReceiptAsync',
    'AllowsProgressFor',
    'trusted_root_isolation_unavailable',
    'trusted_root_isolation_reservation_invalid',
    'trusted_root_isolation_reservation_replay_invalid',
    'trusted_root_isolation_bind_invalid',
    'trusted_root_isolation_bind_replay_invalid',
    'trusted_root_isolation_terminal_receipt_invalid',
    'trusted_root_isolation_terminal_receipt_replay_invalid',
    'trusted_root_isolation_enforcement_not_continuous',
    '_isolationDispatchLatch.ThrowIfTripped()',
    'TripIsolationUnsafe(',
    'OutcomeUncertain: true'
  )) {
  if ($privilegedCommandSource -notmatch [regex]::Escape($requiredBoundary)) {
    $problems.Add("Privileged command boundary is missing $requiredBoundary.")
  }
}
if ($privilegedCommandSource -match 'UseShellExecute\s*=\s*true|System\.Management\.Automation|Runspace') {
  $problems.Add('Privileged command boundary must use the native exact-argv path only.')
}
if ($privilegedCommandSource -match '\bAssignProcessToJobObject\s*\(') {
  $problems.Add(
    'Privileged command must not retain post-create Job assignment.')
}
$trustedRootGateCalls = [regex]::Matches(
  $privilegedCommandSource,
  '\b_trustedRootIsolation\.(?<Method>[A-Za-z_][A-Za-z0-9_]*)\s*\(')
if ($trustedRootGateCalls.Count -ne 1 `
    -or $trustedRootGateCalls[0].Groups['Method'].Value -cne 'TryReserveAsync') {
  $problems.Add(
    'Privileged command must use only the reservation entry point on its isolation gate.')
}

$runOwnedStart = $privilegedCommandSource.IndexOf(
  'private async ValueTask<PrivilegedCommandResult> RunOwnedAsync(',
  [StringComparison]::Ordinal)
$releaseBeforeBindStart = $privilegedCommandSource.IndexOf(
  'private async ValueTask ReleaseBeforeBindAsync(',
  [StringComparison]::Ordinal)
if ($runOwnedStart -lt 0 -or $releaseBeforeBindStart -le $runOwnedStart) {
  $problems.Add('Privileged command runner is missing its owned lifecycle method shape.')
}
else {
  $runOwnedSource = $privilegedCommandSource.Substring(
    $runOwnedStart,
    $releaseBeforeBindStart - $runOwnedStart)
  if ($runOwnedSource -notmatch
      '(?s)ProcessAttributeList\.Create\(\s*job,.*?' +
      'CreateProcessWithAudit\(.*?CreateSuspended\s*\|.*?' +
      'ExtendedStartupInfoPresent,.*?ref startup') {
    $problems.Add(
      'Privileged process creation must consume the Job-list startup attributes while suspended.')
  }
  Assert-LiteralOrder -Source $runOwnedSource `
    -Description 'Privileged reservation-bind-resume-terminal lifecycle' -Literals @(
      'ProcessAttributeList.Create(',
      '_trustedRootIsolation.TryReserveAsync(',
      'PrivilegedCommandTrustedRootIsolationVerifier.ReservationMatches(',
      '_isolationReplayStore.CommitReservationAsync(',
      'CreateProcessWithAudit(',
      'ValidateProcessImage(',
      'IsProcessInJob(',
      'isolationSession.TryBindSuspendedProcessAsync(',
      'PrivilegedCommandTrustedRootIsolationVerifier.BindMatches(',
      '_isolationReplayStore.CommitBindAcknowledgementAsync(',
      '_nativeResumeAttempt();',
      'processResumed = true;',
      'ResumeThread(',
      'SettleBoundProcessAsync('
    )
  foreach ($singleTransition in @(
      '_trustedRootIsolation.TryReserveAsync(',
      '_isolationReplayStore.CommitReservationAsync(',
      'CreateProcessWithAudit(',
      'isolationSession.TryBindSuspendedProcessAsync(',
      '_isolationReplayStore.CommitBindAcknowledgementAsync(',
      'ResumeThread('
    )) {
    if ([regex]::Matches(
        $runOwnedSource,
        [regex]::Escape($singleTransition)).Count -ne 1) {
      $problems.Add(
        "Privileged owned lifecycle must contain exactly one $singleTransition transition.")
    }
  }
  Assert-LiteralOrder -Source $runOwnedSource `
    -Description 'Privileged single terminal-settlement guard' -Literals @(
      'var terminalSettlementAttempted = false;',
      'terminalSettlementAttempted = true;',
      'var terminalReceipt = await SettleBoundProcessAsync(',
      'else if (!terminalSettlementAttempted)',
      '_ = await SettleBoundProcessAsync('
    )
  if ([regex]::Matches(
      $runOwnedSource,
      '\bSettleBoundProcessAsync\s*\(').Count -ne 2 `
      -or [regex]::Matches(
        $runOwnedSource,
        '\bterminalSettlementAttempted\s*=\s*true\s*;').Count -ne 1 `
      -or [regex]::Matches(
        $runOwnedSource,
        '!terminalSettlementAttempted').Count -ne 1) {
    $problems.Add(
      'Privileged command must attempt one success settlement or one guarded failure settlement, never both.')
  }
}

$settleBoundProcessStart = $privilegedCommandSource.IndexOf(
  'private async ValueTask<VerifiedPrivilegedCommandIsolationTerminalReceipt>',
  [StringComparison]::Ordinal)
$ensureReplayCommitStart = $privilegedCommandSource.IndexOf(
  'private async ValueTask CommitIsolationEvidenceAsync(',
  [StringComparison]::Ordinal)
if ($releaseBeforeBindStart -lt 0 -or $settleBoundProcessStart -le $releaseBeforeBindStart) {
  $problems.Add('Privileged command is missing its signed pre-bind release helper shape.')
}
else {
  $releaseBeforeBindSource = $privilegedCommandSource.Substring(
    $releaseBeforeBindStart,
    $settleBoundProcessStart - $releaseBeforeBindStart)
  Assert-LiteralOrder -Source $releaseBeforeBindSource `
    -Description 'Privileged signed pre-bind release' -Literals @(
      'isolationSession.TryReleaseBeforeBindAsync(',
      'PrivilegedCommandTrustedRootIsolationVerifier.PreBindReleaseMatches(',
      'outcome))',
      '_isolationReplayStore.CommitPreBindReleaseAsync(',
      'release.ReleaseSha256'
    )
  if ([regex]::Matches(
      $releaseBeforeBindSource,
      '\bTryReleaseBeforeBindAsync\s*\(').Count -ne 1 `
      -or [regex]::Matches(
        $releaseBeforeBindSource,
        '\bCommitPreBindReleaseAsync\s*\(').Count -ne 1) {
    $problems.Add(
      'Privileged pre-bind cleanup must request and durably commit one signed release.')
  }
}
if ($settleBoundProcessStart -lt 0 -or
    $ensureReplayCommitStart -le $settleBoundProcessStart) {
  $problems.Add('Privileged command is missing its signed terminal-settlement helper shape.')
}
else {
  $settleBoundProcessSource = $privilegedCommandSource.Substring(
    $settleBoundProcessStart,
    $ensureReplayCommitStart - $settleBoundProcessStart)
  Assert-LiteralOrder -Source $settleBoundProcessSource `
    -Description 'Privileged signed terminal settlement' -Literals @(
      'isolationSession.TrySettleAsync(',
      'PrivilegedCommandTrustedRootIsolationVerifier.TerminalReceiptMatches(',
      '_isolationReplayStore.CommitTerminalReceiptAsync(',
      'terminalReceipt.ReceiptSha256',
      'if (!terminalReceipt.IsIsolationIntact)',
      'trusted_root_isolation_enforcement_not_continuous',
      'return terminalReceipt;'
    )
  if ([regex]::Matches(
      $settleBoundProcessSource,
      '\bTrySettleAsync\s*\(').Count -ne 1 `
      -or [regex]::Matches(
        $settleBoundProcessSource,
        '\bCommitTerminalReceiptAsync\s*\(').Count -ne 1) {
    $problems.Add(
      'Privileged terminal settlement must request and durably commit one signed receipt.')
  }
}

if ([regex]::Matches(
    $privilegedCommandSource,
    '(?s)catch\s*\(PrivilegedCommandIsolationUnsafeException\)\s*\{\s*' +
    '_isolationDispatchLatch\.Trip\(\);\s*throw;\s*\}').Count -ne 3) {
  $problems.Add(
    'Every privileged isolation-unsafe cleanup/commit failure must trip the process-lifetime dispatch latch.')
}

$processAttributeStart = $privilegedCommandSource.IndexOf(
  'private sealed class ProcessAttributeList : IDisposable',
  [StringComparison]::Ordinal)
$processAttributeEnd = $privilegedCommandSource.IndexOf(
  'private sealed class SafeKernelHandle',
  [StringComparison]::Ordinal)
if ($processAttributeStart -lt 0 -or $processAttributeEnd -le $processAttributeStart) {
  $problems.Add('Privileged command is missing its native process attribute-list boundary.')
}
else {
  $processAttributeSource = $privilegedCommandSource.Substring(
    $processAttributeStart,
    $processAttributeEnd - $processAttributeStart)
  foreach ($requiredAttributeBufferShape in @(
      'private readonly IntPtr _handleBuffer;',
      'private readonly IntPtr _jobBuffer;',
      'handleBuffer = Marshal.AllocHGlobal(checked(IntPtr.Size * handles.Length));',
      'jobBuffer = Marshal.AllocHGlobal(IntPtr.Size);',
      'Marshal.FreeHGlobal(_handleBuffer);',
      'Marshal.FreeHGlobal(_jobBuffer);'
    )) {
    if ($processAttributeSource -notmatch
        [regex]::Escape($requiredAttributeBufferShape)) {
      $problems.Add(
        "Privileged atomic startup attributes are missing $requiredAttributeBufferShape.")
    }
  }
  if ([regex]::Matches(
      $processAttributeSource,
      '(?s)InitializeProcThreadAttributeList\(\s*' +
      '(?:IntPtr\.Zero|attributeList),\s*2,\s*0,\s*ref size\)').Count -ne 2) {
    $problems.Add(
      'Privileged command must initialize exactly two startup attributes: handles and the Job list.')
  }
  if ($processAttributeSource -notmatch
      '(?s)Marshal\.WriteIntPtr\(jobBuffer,\s*job\.DangerousGetHandle\(\)\);\s*' +
      'if \(!UpdateProcThreadAttribute\(\s*attributeList,\s*0,\s*' +
      'ProcThreadAttributeJobList,\s*jobBuffer,\s*checked\(\(nuint\)IntPtr\.Size\)') {
    $problems.Add(
      'Privileged command must place the owned Job in PROC_THREAD_ATTRIBUTE_JOB_LIST.')
  }
  Assert-LiteralOrder -Source $processAttributeSource `
    -Description 'Privileged atomic startup attribute construction' -Literals @(
      'ProcThreadAttributeHandleList',
      'Marshal.WriteIntPtr(jobBuffer, job.DangerousGetHandle());',
      'ProcThreadAttributeJobList'
    )
  if ([regex]::Matches(
      $processAttributeSource,
      '\bUpdateProcThreadAttribute\s*\(').Count -ne 2) {
    $problems.Add(
      'Privileged startup attributes must contain exactly the inherited-handle and Job lists.')
  }
  if ([regex]::Matches(
      $processAttributeSource,
      '\bProcThreadAttributeJobList\b').Count -ne 1 `
      -or [regex]::Matches(
        $privilegedCommandSource,
        '\bProcThreadAttributeJobList\b').Count -ne 2) {
    $problems.Add(
      'Privileged command must declare and apply PROC_THREAD_ATTRIBUTE_JOB_LIST exactly once.')
  }
}

$privilegedCommandIsolationSource = Get-Content -Raw -LiteralPath `
  $privilegedCommandIsolationBoundary
foreach ($requiredBoundary in @(
    'IPrivilegedCommandTrustedRootIsolationSession',
    'IPrivilegedCommandTrustedRootIsolationGate',
    'IPrivilegedCommandTrustedRootIsolationRecovery',
    'RejectingPrivilegedCommandTrustedRootIsolationGate',
    'PrivilegedCommandIsolationDispatchLatch',
    'PrivilegedCommandIsolationUnsafeException',
    'trusted_root_isolation_reconciliation_required',
    'VerifiedPrivilegedCommandIsolationReservation Reservation',
    'TryReleaseBeforeBindAsync',
    'TryBindSuspendedProcessAsync',
    'TrySettleAsync',
    'TryReserveAsync',
    'TryRecoverPendingReservationAsync',
    'TryRecoverPendingBindAsync',
    'ReservationMatches',
    'BindMatches',
    'TerminalReceiptMatches',
    'Exact(signedRelease.Outcome, expectedOutcome)',
    'CancellationToken cancellationToken) => default;',
    'action.RequiredFeatures.SequenceEqual('
  )) {
  if ($privilegedCommandIsolationSource -notmatch [regex]::Escape($requiredBoundary)) {
    $problems.Add("Privileged command isolation boundary is missing $requiredBoundary.")
  }
}
if ($privilegedCommandIsolationSource -match
    '\b(?:class|record)\s+VerifiedPrivilegedCommandIsolation[A-Za-z0-9_]*\b') {
  $problems.Add(
    'Privileged-command isolation markers must be minted only by the signed contract verifier.')
}
$nativeCreateCalls = [regex]::Matches(
  $privilegedCommandSource,
  '\bCreateProcessNative\s*\(')
if ($nativeCreateCalls.Count -ne 2) {
  $problems.Add(
    'Privileged command must have one audited CreateProcessNative call and one declaration.')
}
$isolationReserveMethods = [regex]::Matches(
  $privilegedCommandIsolationSource,
  '\bTryReserveAsync\s*\(')
if ($isolationReserveMethods.Count -ne 2) {
  $problems.Add(
    'Privileged-command isolation must contain only the session-gate interface and rejecting reserve method.')
}
foreach ($sessionMethod in @(
    'TryReleaseBeforeBindAsync',
    'TryBindSuspendedProcessAsync',
    'TrySettleAsync'
  )) {
  if ([regex]::Matches(
      $privilegedCommandIsolationSource,
      "\b$sessionMethod\s*\(").Count -ne 1) {
    $problems.Add(
      "Privileged-command isolation session must declare exactly one $sessionMethod method.")
  }
}
foreach ($recoveryMethod in @(
    'TryRecoverPendingReservationAsync',
    'TryRecoverPendingBindAsync'
  )) {
  if ([regex]::Matches(
      $privilegedCommandIsolationSource,
      "\b$recoveryMethod\s*\(").Count -ne 2) {
    $problems.Add(
      "Privileged-command recovery must contain only the settlement interface and rejecting method for $recoveryMethod.")
  }
}

$privilegedCommandIsolationContractSource = Get-Content -Raw -LiteralPath `
  $privilegedCommandIsolationContracts
foreach ($requiredContract in @(
    'public const int ContractVersion = 2',
    'PrivilegedCommandIsolationActionAuthorizationV2',
    'IdempotencyKeySha256',
    'PrivilegedCommandIsolationInvocationV2',
    'InvocationBytes(',
    'InvocationSha256(',
    'PrivilegedCommandDriverAttestationEvidenceV2',
    'DriverAttestationSignatureBytes(',
    'VerifyDriverAttestation(',
    'public static bool IsValidReservationRequest(',
    'AddBudget(fields, value.Authorization.Budgets)',
    'PrivilegedCommandIsolationReservationRequestV1',
    'public sealed record SignedPrivilegedCommandIsolationReservationLease',
    'public sealed record SignedPrivilegedCommandIsolationPreBindRelease',
    'PrivilegedCommandSuspendedProcessBindingV1',
    'public sealed record SignedPrivilegedCommandIsolationBindAcknowledgement',
    'public sealed record SignedPrivilegedCommandIsolationTerminalReceipt',
    'PrivilegedCommandIsolationSignaturePurposes.ReservationLease',
    'PrivilegedCommandIsolationSignaturePurposes.PreBindReservationRelease',
    'PrivilegedCommandIsolationSignaturePurposes.SuspendedProcessBindAcknowledgement',
    'PrivilegedCommandIsolationSignaturePurposes.TerminalEnforcementReceipt',
    'VerifyReservation(',
    'VerifyReservationForRecovery(',
    'VerifyPreBindRelease(',
    'VerifyPreBindReleaseForRecovery(',
    'VerifyBindAcknowledgement(',
    'VerifyBindAcknowledgementForRecovery(',
    'VerifyTerminalReceipt(',
    'VerifyTerminalReceiptForRecovery(',
    'VerifiedPrivilegedCommandIsolationRecoveryReservation',
    'VerifiedPrivilegedCommandIsolationRecoveryBindAcknowledgement',
    'IPrivilegedCommandIsolationReplayStore',
    'CommitReservationAsync(',
    'CommitPreBindReleaseAsync(',
    'CommitBindAcknowledgementAsync(',
    'CommitTerminalReceiptAsync(',
    'AllowsProgressFor(',
    'ReadPendingAsync(',
    'PrivilegedCommandIsolationPendingReservation',
    'PrivilegedCommandIsolationPendingBind',
    'PrivilegedCommandIsolationIntegrityViolation',
    'IReadOnlyList<PrivilegedCommandIsolationIntegrityViolation> IntegrityViolations',
    'public bool IsIsolationIntact'
  )) {
  if ($privilegedCommandIsolationContractSource -notmatch
      [regex]::Escape($requiredContract)) {
    $problems.Add("Privileged isolation signed contract is missing $requiredContract.")
  }
}
if ($privilegedCommandIsolationContractSource -match 'string\s+IdempotencyKey\s*,') {
  $problems.Add(
    'Persisted privileged-command isolation contracts must carry only the idempotency-key digest.')
}
Assert-LiteralOrder -Source $privilegedCommandIsolationContractSource `
  -Description 'Privileged signed isolation contract declarations' -Literals @(
    'PrivilegedCommandIsolationReservationRequestV1',
    'SignedPrivilegedCommandIsolationReservationLease',
    'PrivilegedCommandSuspendedProcessBindingV1',
    'SignedPrivilegedCommandIsolationBindAcknowledgement',
    'PrivilegedCommandIsolationTerminalReceiptV1',
    'SignedPrivilegedCommandIsolationTerminalReceipt'
  )
Assert-LiteralOrder -Source $privilegedCommandIsolationContractSource `
  -Description 'Privileged signed isolation verification stages' -Literals @(
    'VerifyReservation(',
    'VerifyPreBindRelease(',
    'VerifyBindAcknowledgement(',
    'VerifyTerminalReceipt('
  )
foreach ($requiredFeature in @(
    'exact-invocation-measurement-v2',
    'process-image-file-identity-v2',
    'signed-driver-attestation-v2',
    'windows-security-posture-v1',
    'filesystem-trusted-root-deny-v1',
    'job-kill-on-close-v1',
    'kernel-process-tree-binding-v1',
    'registry-trusted-root-deny-v1',
    'service-control-deny-v1',
    'signed-terminal-enforcement-receipt-v1',
    'supervisor-boot-replay-protection-v1',
    'supervisor-process-control-deny-v1',
    'suspended-process-bind-before-resume-v1'
  )) {
  if ($privilegedCommandIsolationContractSource -notmatch
      [regex]::Escape($requiredFeature)) {
    $problems.Add("Privileged isolation signed contract is missing $requiredFeature.")
  }
}

$verifiedIsolationMarkerNames = @(
  'VerifiedPrivilegedCommandIsolationReservation',
  'VerifiedPrivilegedCommandIsolationRecoveryReservation',
  'VerifiedPrivilegedCommandIsolationPreBindRelease',
  'VerifiedPrivilegedCommandIsolationBindAcknowledgement',
  'VerifiedPrivilegedCommandIsolationRecoveryBindAcknowledgement',
  'VerifiedPrivilegedCommandIsolationTerminalReceipt'
)
foreach ($markerName in $verifiedIsolationMarkerNames) {
  $escapedMarkerName = [regex]::Escape($markerName)
  if ($privilegedCommandIsolationContractSource -notmatch
      "\bpublic\s+sealed\s+class\s+$escapedMarkerName\b") {
    $problems.Add("Verified isolation marker $markerName must remain sealed.")
  }
  $markerConstructors = [regex]::Matches(
    $privilegedCommandIsolationContractSource,
    "(?m)^\s*(?<Access>(?:(?:public|protected|private|internal)\s+)+)" +
    "$escapedMarkerName\s*\(")
  if ($markerConstructors.Count -ne 1 `
      -or $markerConstructors[0].Groups['Access'].Value.Trim() -cne 'internal') {
    $problems.Add(
      "Verified isolation marker $markerName must have exactly one internal-only constructor.")
  }
  if ([regex]::Matches(
      $privilegedCommandIsolationContractSource,
      "\bnew\s+$escapedMarkerName\s*\(").Count -ne 1) {
    $problems.Add(
      "The signed contract verifier must be the sole factory for $markerName.")
  }
}

$productionSources = @(
  Get-ChildItem -LiteralPath (Join-Path $companionRoot 'src') -Recurse -File -Filter '*.cs' |
    Where-Object { $_.FullName -notmatch $generatedPathPattern } |
    ForEach-Object {
      [pscustomobject]@{
        Path = $_.FullName
        Source = Get-Content -Raw -LiteralPath $_.FullName
      }
    }
)
$productionIsolationImplementations = @(
  foreach ($productionSource in $productionSources) {
    foreach ($classMatch in [regex]::Matches(
        $productionSource.Source,
        '(?ms)\b(?:class|struct|record(?:\s+(?:class|struct))?)\s+' +
        '(?<Name>[A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>{;]+>)?\s*' +
        '(?:\([^{};]*\))?\s*:\s*(?<Bases>[^{;]+)\{')) {
      if ($classMatch.Groups['Bases'].Value -match
          '\bIPrivilegedCommandTrustedRootIsolationGate\b') {
        [pscustomobject]@{
          Path = $productionSource.Path
          Name = $classMatch.Groups['Name'].Value
        }
      }
    }
  }
)
if ($productionIsolationImplementations.Count -ne 2 `
    -or @($productionIsolationImplementations | Where-Object {
        $_.Path -eq $privilegedCommandIsolationBoundary -and
        $_.Name -ceq 'RejectingPrivilegedCommandTrustedRootIsolationGate'
      }).Count -ne 1 `
    -or @($productionIsolationImplementations | Where-Object {
        $_.Path -eq $privilegedCommandNamedPipeIsolationClient -and
        $_.Name -ceq 'NamedPipePrivilegedCommandTrustedRootIsolationClient'
      }).Count -ne 1) {
  $problems.Add(
    'Shipped source may contain only the rejecting production gate and the reviewed default-off named-pipe trusted-root client.')
}
if ($privilegedCommandIsolationSource -notmatch
    '(?s)public\s+sealed\s+class\s+' +
    'RejectingPrivilegedCommandTrustedRootIsolationGate\s*:\s*' +
    'IPrivilegedCommandTrustedRootIsolationGate\s*,\s*' +
    'IPrivilegedCommandTrustedRootIsolationRecovery\s*\{.*?' +
    'TryReserveAsync\s*\(.*?CancellationToken cancellationToken\)\s*=>\s*default;') {
  $problems.Add(
    'The production privileged-command isolation gate must remain unconditionally rejecting.')
}

$privilegedCommandNamedPipeIsolationClientSource = Get-Content -Raw -LiteralPath `
  $privilegedCommandNamedPipeIsolationClient
$restrictedServicePeerTokenValidatorSource = Get-Content -Raw -LiteralPath `
  $restrictedServicePeerTokenValidator
$privilegedCommandIsolationKeyResolverSource = Get-Content -Raw -LiteralPath `
  $privilegedCommandIsolationKeyResolver
$privilegedCommandNamedPipeIsolationClientTestSource = Get-Content -Raw -LiteralPath `
  $privilegedCommandNamedPipeIsolationClientTests
$privilegedCommandIsolationClientFactoryTestSource = Get-Content -Raw -LiteralPath `
  $privilegedCommandIsolationClientFactoryTests
foreach ($requiredPipeBoundary in @(
    'public bool Enabled { get; init; }',
    'if (!_options.Enabled)',
    'new WindowsPrivilegedCommandIsolationPipeConnector()',
    'TokenImpersonationLevel.Identification',
    'GetNamedPipeServerProcessId',
    'ProcessIdToSessionId',
    'sessionId != 0',
    'RestrictedServicePeerTokenValidator.IsExactRestrictedService(',
    'ExpectedSupervisorImagePath',
    'ExpectedSupervisorImageSha256',
    'PrivilegedCommandIsolationSupervisorIdentity.ServiceSid',
    'EnsurePathHasNoReparsePoints',
    'ProcessQueryInformation | Synchronize',
    'GenericRead | FileExecute | Synchronize',
    'OpenAndBindMappedImage(process, expectedPath)',
    'ProcessImageFileMapping',
    'information.NumberOfLinks != 1',
    'GetFinalPath(handle)',
    'SHA256.HashData(imageLock)',
    'PayloadDigest.Sha256Hex(request.IdempotencyKey)',
    'CompactActionToken',
    'PrivilegedCommandIsolationInvocationV2 Invocation',
    'JsonUnmappedMemberHandling.Disallow',
    'response.Sequence != sequence',
    'response.CorrelationId',
    'PrivilegedCommandIsolationPipeProtocol.AbsoluteMaximumFrameBytes',
    'TryRecoverPendingReservationAsync',
    'TryRecoverPendingBindAsync',
    'VerifyReservation(',
    'VerifyReservationForRecovery(',
    'VerifyPreBindRelease(',
    'VerifyPreBindReleaseForRecovery(',
    'VerifyBindAcknowledgement(',
    'VerifyBindAcknowledgementForRecovery(',
    'VerifyTerminalReceipt(',
    'VerifyTerminalReceiptForRecovery('
  )) {
  if ($privilegedCommandNamedPipeIsolationClientSource -notmatch
      [regex]::Escape($requiredPipeBoundary)) {
    $problems.Add(
      "Default-off trusted-root pipe client is missing $requiredPipeBoundary.")
  }
}
foreach ($requiredRestrictedPeerBoundary in @(
    'WellKnownSidType.LocalSystemSid',
    'identity.Groups.Contains(requiredServiceSid)',
    'IsTokenRestricted(token)',
    'TokenRestrictedSids',
    'GetTokenInformation(',
    'new SecurityIdentifier(item.Sid).Equals(requiredServiceSid)'
  )) {
  if ($restrictedServicePeerTokenValidatorSource -notmatch
      [regex]::Escape($requiredRestrictedPeerBoundary)) {
    $problems.Add(
      "Trusted supervisor restricted-service peer validation is missing $requiredRestrictedPeerBoundary.")
  }
}
foreach ($requiredKeyBoundary in @(
    'ExactPurposeP256PublicKeyResolver',
    'IPrivilegedCommandIsolationVerificationKeyResolver',
    'AllowedPurposes',
    'Duplicate isolation public-key pins are not allowed.',
    'ImportSubjectPublicKeyInfo',
    'parameters.Curve.Oid.Value',
    'ECCurve.NamedCurves.nistP256.Oid.Value',
    'ExportSubjectPublicKeyInfo',
    'CryptographicOperations.FixedTimeEquals'
  )) {
  if ($privilegedCommandIsolationKeyResolverSource -notmatch
      [regex]::Escape($requiredKeyBoundary)) {
    $problems.Add(
      "Trusted-root purpose-separated public-key resolver is missing $requiredKeyBoundary.")
  }
}
foreach ($requiredPipeRegression in @(
    'PackagedDefaultOffModeNeverOpensAPipe',
    'MalformedOversizedDisconnectedAndOutOfPhaseFramesAreRejected',
    'SignatureSubstitutionFailsClosedBeforeReturningASession',
    'RestartRecoveryHasOnlyReservationAndBindSettlementSurfaces',
    'RestartRecoveryAcceptsExpiredHistoricalLeaseAndBindEvidence',
    'RecoveryRejectsHistoricalEvidenceWithAnInvalidSignatureBeforeConnect',
    'RecoveryRejectsHistoricalEvidenceWhenItsVersionedPinIsMissing',
    'RecoveryRejectsHistoricalBindWhoseProcessBindingChanged',
    'RecoveryStillRejectsStaleNewReleaseAndTerminalReceipts',
    'PublicKeyResolverRequiresExactPurposeAndCanonicalP256Spki',
    'AUserControlledPipeSquatterCannotPassServerIdentityValidation',
    'PersistenceSerializationCannotSeeCompactTokenArgvOrEnvironment'
  )) {
  if ($privilegedCommandNamedPipeIsolationClientTestSource -notmatch
      [regex]::Escape($requiredPipeRegression)) {
    $problems.Add(
      "Trusted-root named-pipe regression coverage is missing $requiredPipeRegression.")
  }
}

$privilegedCommandReplayStoreSource = Get-Content -Raw -LiteralPath `
  $privilegedCommandIsolationReplayStore
foreach ($requiredReplayStoreBoundary in @(
    'internal sealed class FilePrivilegedCommandIsolationReplayStore',
    'IPrivilegedCommandIsolationReplayStore',
    'CommitReservationAsync(',
    'CommitPreBindReleaseAsync(',
    'CommitBindAcknowledgementAsync(',
    'CommitTerminalReceiptAsync(',
    'ReadPendingAsync(',
    'ReadTerminalRecovery(',
    'PrivilegedCommandIsolationCanonical.IsCanonicalSignedTerminalReceipt(',
    'PrivilegedCommandIsolationTerminalOutcomes.IsolationViolation',
    'IntegrityViolations',
    'ValidateAdvance(',
    'AppendDurably(',
    'LoadAndVerify(',
    'EntryValid(',
    'PreviousSha256',
    'EntrySha256',
    'FileOptions.WriteThrough',
    'FileShare.Read',
    '_ledger.Flush(flushToDisk: true)',
    '_ownershipLock = OpenOwnedFile($"{_path}.lock", FileMode.OpenOrCreate)',
    'JsonUnmappedMemberHandling.Disallow',
    'PrivilegedCommandIsolationReplayCommitStatus.AlreadyCommitted',
    'PrivilegedCommandIsolationReplayCommitStatus.StaleSequence',
    'EnsureDirectoryTreeHasNoReparsePoints',
    'RecoveryMaterialSha256'
  )) {
  if ($privilegedCommandReplayStoreSource -notmatch
      [regex]::Escape($requiredReplayStoreBoundary)) {
    $problems.Add(
      "Privileged isolation durable replay store is missing $requiredReplayStoreBoundary.")
  }
}
if ($privilegedCommandReplayStoreSource -match
    '\bFileMode\.(?:Create|CreateNew|Truncate)\b|\bFile\.(?:WriteAllText|WriteAllBytes)\s*\(') {
  $problems.Add(
    'Privileged isolation replay evidence must use only its append-and-flush ledger path.')
}

$replayCommitStart = $privilegedCommandReplayStoreSource.IndexOf(
  'private async ValueTask<PrivilegedCommandIsolationReplayCommitResult> CommitAsync(',
  [StringComparison]::Ordinal)
$replayInitializeStart = $privilegedCommandReplayStoreSource.IndexOf(
  'private async ValueTask EnsureInitializedAsync(',
  [StringComparison]::Ordinal)
if ($replayCommitStart -lt 0 -or $replayInitializeStart -le $replayCommitStart) {
  $problems.Add('Privileged isolation replay store is missing its atomic commit method shape.')
}
else {
  $replayCommitSource = $privilegedCommandReplayStoreSource.Substring(
    $replayCommitStart,
    $replayInitializeStart - $replayCommitStart)
  Assert-LiteralOrder -Source $replayCommitSource `
    -Description 'Privileged durable replay commit' -Literals @(
      'ValidateAdvance(record)',
      'AppendDurably(entry)',
      'Accept(entry)',
      'PrivilegedCommandIsolationReplayCommitStatus.Committed'
    )
}
$appendDurablyStart = $privilegedCommandReplayStoreSource.IndexOf(
  'private void AppendDurably(',
  [StringComparison]::Ordinal)
$loadAndVerifyStart = $privilegedCommandReplayStoreSource.IndexOf(
  'private void LoadAndVerify(',
  [StringComparison]::Ordinal)
if ($appendDurablyStart -lt 0 -or $loadAndVerifyStart -le $appendDurablyStart) {
  $problems.Add('Privileged isolation replay store is missing its durable append shape.')
}
else {
  $appendDurablySource = $privilegedCommandReplayStoreSource.Substring(
    $appendDurablyStart,
    $loadAndVerifyStart - $appendDurablyStart)
  Assert-LiteralOrder -Source $appendDurablySource `
    -Description 'Privileged replay durable append' -Literals @(
      '_ledger.Write(bytes)',
      '_ledger.Flush(flushToDisk: true)'
    )
}
$validateAdvanceStart = $privilegedCommandReplayStoreSource.IndexOf(
  'private PrivilegedCommandIsolationReplayCommitResult? ValidateAdvance(',
  [StringComparison]::Ordinal)
if ($loadAndVerifyStart -lt 0 -or $validateAdvanceStart -le $loadAndVerifyStart) {
  $problems.Add('Privileged isolation replay store is missing its restart verification shape.')
}
else {
  $loadAndVerifySource = $privilegedCommandReplayStoreSource.Substring(
    $loadAndVerifyStart,
    $validateAdvanceStart - $loadAndVerifyStart)
  Assert-LiteralOrder -Source $loadAndVerifySource `
    -Description 'Privileged replay restart verification' -Literals @(
      'EntryValid(entry, checked(_entrySequence + 1), _head)',
      'ValidateAdvance(entry.Record)',
      'Accept(entry)'
    )
}

$productionReplayStoreImplementations = @(
  foreach ($productionSource in $productionSources) {
    foreach ($classMatch in [regex]::Matches(
        $productionSource.Source,
        '(?ms)\b(?:class|struct|record(?:\s+(?:class|struct))?)\s+' +
        '(?<Name>[A-Za-z_][A-Za-z0-9_]*)\s*(?:<[^>{;]+>)?\s*' +
        '(?:\([^{};]*\))?\s*:\s*(?<Bases>[^{;]+)\{')) {
      if ($classMatch.Groups['Bases'].Value -match
          '\bIPrivilegedCommandIsolationReplayStore\b') {
        [pscustomobject]@{
          Path = $productionSource.Path
          Name = $classMatch.Groups['Name'].Value
        }
      }
    }
  }
)
if ($productionReplayStoreImplementations.Count -ne 1 `
    -or $productionReplayStoreImplementations[0].Path -ne
      $privilegedCommandIsolationReplayStore `
    -or $productionReplayStoreImplementations[0].Name -cne
      'FilePrivilegedCommandIsolationReplayStore') {
  $problems.Add(
    'The shipped source must contain exactly one durable privileged-command replay store.')
}

$privilegedCommandIsolationStartupSource = Get-Content -Raw -LiteralPath `
  $privilegedCommandIsolationStartupReconciler
foreach ($requiredStartupBoundary in @(
    'IPrivilegedCommandTrustedRootIsolationRecovery',
    'ReadPendingAsync(',
    'PendingBindExpectation.Freeze(',
    'TryRecoverPendingBindAsync(',
    'CommitTerminalReceiptAsync(',
    'if (!receipt.IsIsolationIntact)',
    'PendingReservationExpectation.Freeze(',
    'TryRecoverPendingReservationAsync(',
    'CommitPreBindReleaseAsync(',
    'RefuseIntegrityViolations(remaining)',
    'remaining.Binds.Count != 0 || remaining.Reservations.Count != 0'
  )) {
  if ($privilegedCommandIsolationStartupSource -notmatch
      [regex]::Escape($requiredStartupBoundary)) {
    $problems.Add(
      "Privileged isolation startup reconciliation is missing $requiredStartupBoundary.")
  }
}
Assert-LiteralOrder -Source $privilegedCommandIsolationStartupSource `
  -Description 'Privileged settlement-only startup recovery' -Literals @(
    'var pending = await replayStore.ReadPendingAsync(',
    'RefuseIntegrityViolations(pending);',
    'foreach (var bind in pending.Binds)',
    'trustedRootRecovery.TryRecoverPendingBindAsync(',
    'replayStore.CommitTerminalReceiptAsync(',
    'if (!receipt.IsIsolationIntact)',
    'foreach (var reservation in pending.Reservations)',
    'trustedRootRecovery.TryRecoverPendingReservationAsync(',
    'replayStore.CommitPreBindReleaseAsync(',
    'var remaining = await replayStore.ReadPendingAsync(',
    'RefuseIntegrityViolations(remaining);'
  )
if ($privilegedCommandIsolationStartupSource -match
    '\bTryReserveAsync\s*\(|\bCreateProcess(?:Native|WithAudit)?\s*\(|\bResumeThread\s*\(') {
  $problems.Add(
    'Privileged startup recovery must remain settlement-only and cannot reserve, create, or resume a process.')
}

$privilegedCommandTestSource = Get-Content -Raw -LiteralPath $privilegedCommandTests
foreach ($requiredLifecycleTest in @(
    'VerifiedLifecycleMarkersHaveNoPublicConstructors',
    'SignedIsolationLifecycleAndReplayCommitsPrecedeEachNativeTransition',
    'BlockingBindCannotResumeOrExecuteTheSuspendedChild',
    'MissingBindKillsTheSuspendedChildAndCommitsPreBindRelease',
    'CancellationAfterVerifiedBindSettlesAsNeverResumed',
    'MissingTerminalReceiptTripsLatchAndIsNotRetriedAfterTheCommandRan',
    'PreBindReleaseOutcomeMustMatchRequestedBranchAndStopsLaterDispatch',
    'IsolationViolationReceiptCommitsBeforePermanentlyFencingDispatch'
  )) {
  if ($privilegedCommandTestSource -notmatch [regex]::Escape($requiredLifecycleTest)) {
    $problems.Add("Privileged command tests are missing $requiredLifecycleTest.")
  }
}
foreach ($requiredFactoryRegression in @(
    'PackagedConfigurationRetainsTheDisabledRejectingDefault',
    'FactorySelectsNamedPipeOnlyForACompleteExactTrustBundle',
    'FactoryRequiresFourIndependentPublicOnlyP256Pins',
    'DependencyInjectionSharesOneSelectedInstanceAcrossLiveAndRecovery',
    'DependencyInjectionSharesTheRejectingFallbackWhenDisabled'
  )) {
  if ($privilegedCommandIsolationClientFactoryTestSource -notmatch
      [regex]::Escape($requiredFactoryRegression)) {
    $problems.Add(
      "Privileged isolation client factory tests are missing $requiredFactoryRegression.")
  }
}
$privilegedCommandIsolationTestSource = Get-Content -Raw -LiteralPath `
  $privilegedCommandIsolationTests
foreach ($requiredContractTest in @(
    'VerifiesReservationBindResumeAndTerminalReceipt',
    'VerifiesSignedPreBindReleaseAsTheOnlyTruthfulNoChildSettlement',
    'PurposeScopedP256KeysCannotBeSubstitutedAcrossStages',
    'BindRequiresAStillSuspendedJobAssignedChildAndLiveKernelEnforcement',
    'TerminalReceiptRequiresEveryPriorDigestAndTheSameSupervisorGeneration',
    'VerifiedMarkersHaveNoPublicConstructors',
    'ReplayCommitResultAllowsOnlyCommittedOrExactIdempotentEvidence'
  )) {
  if ($privilegedCommandIsolationTestSource -notmatch
      [regex]::Escape($requiredContractTest)) {
    $problems.Add("Privileged isolation contract tests are missing $requiredContractTest.")
  }
}
$privilegedCommandReplayStoreTestSource = Get-Content -Raw -LiteralPath `
  $privilegedCommandIsolationReplayStoreTests
foreach ($requiredReplayStoreTest in @(
    'FullLifecycleIsDurableIdempotentAndVerifiedAfterRestart',
    'PreBindReleaseAndBindCommitAtomicallyAsMutuallyExclusive',
    'StaleSequenceAndCrossActionNonceReplayFailClosed',
    'MissingPrerequisitesNeverWriteTerminalOrBindEvidence',
    'TamperedHashChainIsUnavailableAfterRestart',
    'ConcurrentLedgerOwnerFailsClosedWithoutBlockingTheOwner',
    'ReparsePointAncestorFailsClosedWithoutWritingTheTarget',
    'IsolationViolationReceiptPermanentlyFencesRestart'
  )) {
  if ($privilegedCommandReplayStoreTestSource -notmatch
      [regex]::Escape($requiredReplayStoreTest)) {
    $problems.Add("Privileged isolation replay tests are missing $requiredReplayStoreTest.")
  }
}

$egressSupervisorProgramSource = Get-Content -Raw -LiteralPath $egressSupervisorProgram
$egressSupervisorIdentitySource = Get-Content -Raw -LiteralPath $egressSupervisorIdentity
$egressSupervisorRegistrationSource = Get-Content -Raw -LiteralPath `
  $egressSupervisorRegistration
$egressSupervisorEngineSource = Get-Content -Raw -LiteralPath $egressSupervisorEngine
$egressSupervisorDestinationPolicySource = Get-Content -Raw -LiteralPath `
  $egressSupervisorDestinationPolicy
$egressSupervisorDataServiceSource = Get-Content -Raw -LiteralPath `
  $egressSupervisorDataService
$egressSupervisorExactRequestValidatorSource = Get-Content -Raw -LiteralPath `
  $egressSupervisorExactRequestValidator
$egressSupervisorPipeBoundarySource = Get-Content -Raw -LiteralPath `
  $egressSupervisorPipeBoundary
$egressSupervisorPostureSource = Get-Content -Raw -LiteralPath $egressSupervisorPosture
$egressSupervisorSecretVaultSource = Get-Content -Raw -LiteralPath `
  $egressSupervisorSecretVault
$egressSupervisorKillSwitchSource = Get-Content -Raw -LiteralPath `
  $egressSupervisorKillSwitch
$egressSupervisorSigningKeysSource = Get-Content -Raw -LiteralPath `
  $egressSupervisorSigningKeys
$egressSupervisorProcessBoundarySource = Get-Content -Raw -LiteralPath `
  $egressSupervisorProcessBoundary
$egressSupervisorRestrictedTokenSource = Get-Content -Raw -LiteralPath `
  $egressSupervisorRestrictedToken
$egressSupervisorJournalSource = Get-Content -Raw -LiteralPath $egressSupervisorJournal
$egressSupervisorJournalProtectionSource = Get-Content -Raw -LiteralPath `
  $egressSupervisorJournalProtection
$egressSupervisorTestSource = Get-Content -Raw -LiteralPath $egressSupervisorTests

foreach ($requiredIdentityBoundary in @(
    'Itemba Msaidizi Egress Supervisor',
    'S-1-5-80-2691216044-51290016-1044150087-1430489630-3303720160',
    'Itemba Msaidizi Companion',
    'S-1-5-80-341263411-3719254221-1864525750-3877438856-2718495063'
  )) {
  if ($egressSupervisorIdentitySource -notmatch
      [regex]::Escape($requiredIdentityBoundary)) {
    $problems.Add("Fixed egress supervisor identity is missing $requiredIdentityBoundary.")
  }
}
foreach ($requiredActiveBoundary in @(
    'if (options.Enabled)',
    'ValidateActiveServiceContext(options)',
    'WellKnownSidType.LocalSystemSid',
    'EgressSupervisorTrustIdentity.ServiceSid',
    'identity.Groups.Contains(supervisorSid)',
    'RestrictedServiceTokenValidator.IsRestrictedTo(',
    'Process.GetCurrentProcess().SessionId.Equals(0)',
    'WindowsEgressProcessObjectBoundary.GrantCompanionQueryAccess(options)',
    'egress-supervisor',
    'lifecycle.v2.jsonl'
  )) {
  if ($egressSupervisorProgramSource -notmatch
      [regex]::Escape($requiredActiveBoundary)) {
    $problems.Add("Active egress supervisor host is missing $requiredActiveBoundary.")
  }
}
foreach ($requiredSafeOffBoundary in @(
    'if (!options.Enabled)',
    'services.AddHostedService<DisabledEgressSupervisorService>()',
    'return services',
    'requirePreprovisionedFiles: true',
    'new CertificateStoreEgressSupervisorSigningKeys(',
    'WindowsEgressHostPostureProvider(',
    'services.AddSingleton<IEgressOutboundConnector, TcpEgressOutboundConnector>()',
    'services.AddHostedService<NamedPipeEgressControlService>()',
    'services.AddHostedService<NamedPipeEgressDataService>()'
  )) {
  if ($egressSupervisorRegistrationSource -notmatch
      [regex]::Escape($requiredSafeOffBoundary)) {
    $problems.Add("Egress supervisor activation boundary is missing $requiredSafeOffBoundary.")
  }
}
Assert-LiteralOrder -Source $egressSupervisorRegistrationSource `
  -Description 'Egress supervisor safe-off registration' -Literals @(
    'if (!options.Enabled)',
    'services.AddHostedService<DisabledEgressSupervisorService>()',
    'return services',
    'EgressDestinationPolicy.Load(',
    'new DurableEgressJournal(',
    'new CertificateStoreEgressSupervisorSigningKeys(',
    'new WindowsEgressHostPostureProvider(',
    'services.AddHostedService<NamedPipeEgressControlService>()',
    'services.AddHostedService<NamedPipeEgressDataService>()'
  )
foreach ($requiredPipeBoundary in @(
    'PipeRejectRemoteClients',
    'FileFlagFirstPipeInstance',
    'security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false)',
    'PipeAccessRights.ReadWrite | PipeAccessRights.Synchronize',
    'GetNamedPipeClientProcessId',
    'ProcessIdToSessionId',
    'ProcessQueryInformation | Synchronize',
    'FileShareRead',
    'ProcessImageFileMapping',
    'GetFinalPath(handle)',
    'information.NumberOfLinks != 1',
    'SHA256.HashData(imageLock)',
    'RestrictedServiceTokenValidator.IsRestrictedTo(',
    'GetProcessTimes('
  )) {
  if ($egressSupervisorPipeBoundarySource -notmatch
      [regex]::Escape($requiredPipeBoundary)) {
    $problems.Add("Egress supervisor pipe boundary is missing $requiredPipeBoundary.")
  }
}
foreach ($requiredTokenRestriction in @(
    'IsTokenRestricted(token)',
    'TokenRestrictedSids',
    'GetTokenInformation(',
    'new SecurityIdentifier(item.Sid).Equals(requiredServiceSid)'
  )) {
  if ($egressSupervisorRestrictedTokenSource -notmatch
      [regex]::Escape($requiredTokenRestriction)) {
    $problems.Add("Egress restricted-token proof is missing $requiredTokenRestriction.")
  }
}
foreach ($requiredPostureBoundary in @(
    'GetFirmwareEnvironmentVariable("SecureBoot"',
    'HypervisorEnforcedCodeIntegrity',
    'NtQuerySystemInformation(',
    'EnumDeviceDrivers(',
    'ImageMatches(options.DriverImagePath, options.DriverMeasurementSha256)',
    'DeviceIoControl(',
    'RandomNumberGenerator.GetBytes(32)',
    'destinationPolicySha256',
    'CryptographicOperations.FixedTimeEquals(response, expected)',
    'CurrentProcessImageMatches(',
    'OpenProcess(',
    'ProcessImageFileMapping',
    'GetFinalPath(handle)',
    'information.NumberOfLinks != 1',
    'SHA256.HashData(stream)'
  )) {
  if ($egressSupervisorPostureSource -notmatch
      [regex]::Escape($requiredPostureBoundary)) {
    $problems.Add("Live egress posture proof is missing $requiredPostureBoundary.")
  }
}
foreach ($requiredSigningBoundary in @(
    'Microsoft Platform Crypto Provider',
    'privateKey.ExportPolicy != CngExportPolicies.None',
    'key.GetProperty("Security Descr", (CngPropertyOptions)0x4)',
    'descriptor.DiscretionaryAcl.Count != 1',
    'ace.AccessMask != GenericAll',
    'observed.SetEquals([supervisorSid])',
    'actionVerificationKey.ExportSubjectPublicKeyInfo()',
    'ArePurposeSeparatedPublicSpkis(',
    '!SamePublicSpki(attestationSpki, receiptSpki)',
    '!SamePublicSpki(attestationSpki, actionVerificationSpki)',
    '!SamePublicSpki(receiptSpki, actionVerificationSpki)',
    'CryptographicOperations.ZeroMemory(attestationSpki)',
    'CryptographicOperations.ZeroMemory(receiptSpki)',
    'CryptographicOperations.ZeroMemory(actionVerificationSpki)'
  )) {
  if ($egressSupervisorSigningKeysSource -notmatch
      [regex]::Escape($requiredSigningBoundary)) {
    $problems.Add("Egress TPM signing-key boundary is missing $requiredSigningBoundary.")
  }
}
foreach ($requiredProcessBoundary in @(
    'CompanionProcessAccessMask = 0x00100400',
    'SetKernelObjectSecurity(',
    'HasExactPeerGrant(',
    'common.AccessMask != CompanionProcessAccessMask',
    'return matches == 1'
  )) {
  if ($egressSupervisorProcessBoundarySource -notmatch
      [regex]::Escape($requiredProcessBoundary)) {
    $problems.Add("Egress reciprocal process boundary is missing $requiredProcessBoundary.")
  }
}
foreach ($requiredJournalBoundary in @(
    'Single-writer, write-through, hash-chained lifecycle journal',
    'requirePreprovisionedFiles',
    'FileShare.None',
    'FileOptions.WriteThrough',
    '_journal.Flush(flushToDisk: true)',
    'The egress lifecycle journal has a partial tail.',
    'FixedTimeHex(record.PreviousSha256, _headSha256)',
    'ValidateTransition(prior, session)'
  )) {
  if ($egressSupervisorJournalSource -notmatch
      [regex]::Escape($requiredJournalBoundary)) {
    $problems.Add("Egress durable lifecycle journal is missing $requiredJournalBoundary.")
  }
}
foreach ($requiredJournalProtection in @(
    'FileAttributeReparsePoint',
    'information.NumberOfLinks != 1',
    'GetFinalPath(handle)',
    'AccessControlSections.Owner | AccessControlSections.Access',
    'ControlFlags.DiscretionaryAclProtected'
  )) {
  if ($egressSupervisorJournalProtectionSource -notmatch
      [regex]::Escape($requiredJournalProtection)) {
    $problems.Add("Egress NTFS journal protection is missing $requiredJournalProtection.")
  }
}
foreach ($requiredEngineBoundary in @(
    'flow-recovered-uncertain',
    'TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously)',
    'await completion.WaitAsync(',
    'ActionExecutionModes.Execute',
    'TryExpectedCapabilityEgressBytes(',
    'BrokerSerializedResultUpperBoundBytes',
    'BrokerMaxRequestAttemptsPerSession',
    'BrokerMaxDeliverySessions',
    'expectedCapabilityEgressBytes = checked(',
    'budgets.MaxExternalEgressBytes - brokerReservation',
    'binding.ReservedCapabilityEgressBytes != expectedCapabilityEgressBytes',
    'request.ArgumentsJsonUtf8',
    'EgressExternalActionCanonical.TryCreate(',
    'EgressDestinationPolicy.ExactRequestPolicySha256(',
    'EgressSupervisorLifecycleCanonical.RegistrationSha256(',
    'EgressSupervisorLifecycleCanonical.DispositionSha256(',
    'EgressSupervisorLifecycleContract.Unknown',
    'lease.ReservedCapabilityEgressBytes - measured',
    'receipt.RegistrationSha256',
    'receipt.DispositionSha256',
    'RecordDirectRouteAsync(',
    'flow-route-attested'
  )) {
  if ($egressSupervisorEngineSource -notmatch
      [regex]::Escape($requiredEngineBoundary)) {
    $problems.Add("Egress supervisor lifecycle engine is missing $requiredEngineBoundary.")
  }
}
foreach ($requiredDestinationPolicyBoundary in @(
    'CredentialRecordSha256',
    'ComputeDestinationScopeSha256(canonical)',
    'CredentialRecordSha256 = entry.CredentialRecordSha256.ToLowerInvariant()',
    'MSAIDIZI-EGRESS-EXACT-REQUEST-POLICY-V1',
    'entry.DestinationPathAndQuery',
    'entry.ServerCertificateSha256Pin',
    'entry.CredentialReferenceId',
    'entry.CredentialRecordSha256',
    'entry.DestinationScopeSha256',
    'argumentsSha256',
    'expectedPreStateSha256',
    'idempotencyKeySha256',
    'requestBodySha256'
  )) {
  if ($egressSupervisorDestinationPolicySource -notmatch
      [regex]::Escape($requiredDestinationPolicyBoundary)) {
    $problems.Add(
      "Exact egress destination policy is missing $requiredDestinationPolicyBoundary.")
  }
}
foreach ($requiredExactRequestBoundary in @(
    'flow.DestinationPathAndQuery',
    'flow.DestinationHost',
    'flow.DestinationPort',
    'flow.RequestBodySha256',
    'flow.ExpectedPreStateSha256',
    'flow.IdempotencyKeySha256',
    'flow.CredentialReferenceId',
    'Authorization-Reference:',
    'Authorization:',
    'CryptographicOperations.ZeroMemory'
  )) {
  if ($egressSupervisorExactRequestValidatorSource -notmatch
      [regex]::Escape($requiredExactRequestBoundary)) {
    $problems.Add(
      "Exact supervisor HTTP request validator is missing $requiredExactRequestBoundary.")
  }
}
foreach ($requiredSecretVaultBoundary in @(
    'credentialRecordSha256',
    'SHA256.HashData(protectedPayload)',
    'active policy pin',
    'plaintext = Unprotect(protectedPayload)',
    'record.Capabilities.Contains(capabilityId, StringComparer.Ordinal)',
    'record.DestinationScopeSha256',
    'information.NumberOfLinks != 1',
    'GetFinalPath(stream.SafeFileHandle)',
    'formatVersion != 2'
  )) {
  if ($egressSupervisorSecretVaultSource -notmatch
      [regex]::Escape($requiredSecretVaultBoundary)) {
    $problems.Add("Read-only supervisor secret vault is missing $requiredSecretVaultBoundary.")
  }
}
Assert-LiteralOrder -Source $egressSupervisorSecretVaultSource `
  -Description 'Credential record pin precedes DPAPI and network consumer use' -Literals @(
    'SHA256.HashData(protectedPayload)',
    'credentialRecordSha256',
    'plaintext = Unprotect(protectedPayload)',
    'record.Capabilities.Contains(capabilityId, StringComparer.Ordinal)',
    'return await consumer('
  )
foreach ($requiredKillBoundary in @(
    'for (var current = new DirectoryInfo(root);',
    'current = current.Parent',
    'FileAttributes.Directory',
    'FileAttributes.ReparsePoint',
    'System.Security.SecurityException',
    'applicationLifetime.StopApplication()',
    'TimeSpan.FromMilliseconds(100)'
  )) {
  if ($egressSupervisorKillSwitchSource -notmatch
      [regex]::Escape($requiredKillBoundary)) {
    $problems.Add("Egress trusted-root kill switch is missing $requiredKillBoundary.")
  }
}
foreach ($requiredDataPlaneBoundary in @(
    'new TcpClient(AddressFamily.InterNetworkV6)',
    'No TCP/UDP listener is exposed.',
    'engine.BeginDirectFlowAsync(',
    'outboundConnector.ConnectAsync(',
    'flow.ReservationDnsAnswerSetSha256',
    'engine.RecordDirectRouteAsync(',
    'flow.MaximumExternalEgressBytes',
    'new CiphertextMeteringStream(',
    'new SslStream(',
    'EgressExactHttpRequestValidator.IsAuthorized(',
    'secretVault.UseAsync(',
    'EgressExactHttpRequestValidator.CreateAuthorizedRequest(',
    'DisableCertificateDownloads = true',
    'X509RevocationMode.NoCheck',
    'operationCancellation.Token',
    'remoteConnectCancellation.Token',
    'options.FlowOperationTimeoutSeconds',
    'flow.ExpiresAtUnixMilliseconds',
    'WriteTransferResponseAsync(',
    'value => measured = value',
    '_bytesWritten = checked(_bytesWritten + bytes.Length)',
    'engine.CompleteDirectFlowAsync(',
    'applicationLifetime.StopApplication()'
  )) {
  if ($egressSupervisorDataServiceSource -notmatch
      [regex]::Escape($requiredDataPlaneBoundary)) {
    $problems.Add("Egress supervisor data plane is missing $requiredDataPlaneBoundary.")
  }
}
$egressSocketOwners = Get-ChildItem -LiteralPath `
    (Join-Path $companionRoot 'src\Msaidizi.EgressSupervisor') -Recurse -File -Filter '*.cs' |
  Where-Object { $_.FullName -notmatch $generatedPathPattern } |
  Where-Object { Select-String -LiteralPath $_.FullName -Pattern '\b(?:TcpClient|Socket)\b' }
foreach ($owner in $egressSocketOwners) {
  if ($owner.FullName -ne $egressSupervisorDataService) {
    $problems.Add("Only the reviewed egress data service may own an outbound socket: $($owner.FullName)")
  }
}
$egressListenerMatches = Get-ChildItem -LiteralPath `
    (Join-Path $companionRoot 'src\Msaidizi.EgressSupervisor') -Recurse -File -Filter '*.cs' |
  Where-Object { $_.FullName -notmatch $generatedPathPattern } |
  Select-String -Pattern '\b(?:TcpListener|UdpClient|HttpListener|KestrelServer|ListenAnyIP)\b'
foreach ($match in $egressListenerMatches) {
  $problems.Add("Egress supervisor must expose no network listener: $($match.Path):$($match.LineNumber)")
}
foreach ($requiredEgressSupervisorRegression in @(
    'DirectLifecycleBindsExactHashesAndProducesValidV2Receipt',
    'FlowNonceIsOneTimeAndWrongPreimageDoesNotConsumeIt',
    'RestartTurnsActiveFlowIntoUnknownFullChargeWithoutDuplicateMutation',
    'ImmediateSettlementWaitsForExactFlowCloseAndReplaysIdempotently',
    'JournalTamperingAndConcurrentOwnershipFailClosed',
    'UnsupportedProcessAndBrowserBoundariesStayUnavailable',
    'LivePostureChangePreventsARegisteredFlowFromOpening',
    'DataPlaneHasRemoteRejectionFirstInstanceAndNoListenerState',
    'SupervisorConnectorOwnsTheOnlyOutboundSocket',
    'RouteDigestsNormalizeSortAndDeduplicateWithoutPersistingAddressText',
    'ConnectorRejectsPublicDnsAnswerSetChurnBeforeDial',
    'ConsumedFlowWithoutRouteEvidenceCanOnlyTerminalizeUnknown',
    'PackagedDefaultsAreSafeOffAndProvisioningRequired',
    'SafeDisabledHostStartsWithoutRegisteringAnyActiveBoundary',
    'SigningKeyAclRequiresOnlyTheRestrictedServiceGrant',
    'SigningKeyPurposeSeparationUsesCanonicalPublicSpkis',
    'SupervisorProcessGrantReplacesEveryWiderCompanionAce',
    'RestrictedTokenValidatorRequiresTheSidInTokenRestrictedSids',
    'CapabilityActivationAttestsExactServiceAndAgentAndRejectsReplay',
    'CapabilityActivationRejectsPeerAclAndKillSwitchFailures',
    'BrowserActivationStaysOffWithoutNativeBrowserEvidence',
    'SignedArgumentsAndAuthenticatedProcessCreationCannotBeSubstituted',
    'EverySignedActionBindingSubstitutionIsRejected',
    'ReplayOnlyTokenCannotAuthorizeARealExternalFlow',
    'BrokerReservationInputsAndResidualAreBoundExactly',
    'EveryExactFlowSubstitutionIsRejected',
    'ExactHttpTemplateRejectsPlaintextAndDestinationSubstitution',
    'TlsPolicyCannotCreateUnmeteredRevocationOrCertificateDownloads',
    'ServiceImageMeasurementRequiresTheCurrentMappedFileObject',
    'AlteredPolicyPinnedCredentialRecordIsRejectedBeforeDpapiOrUse',
    'TrustedRootKillSwitchFailsClosedAtStartupAndDuringRuntime',
    'TrustedRootKillSwitchRejectsAnAncestorReparseBoundary',
    'NonReadingPeerCannotOutliveOperationOrKillCancellation'
  )) {
  if ($egressSupervisorTestSource -notmatch
      [regex]::Escape($requiredEgressSupervisorRegression)) {
    $problems.Add(
      "Egress supervisor regressions are missing $requiredEgressSupervisorRegression.")
  }
}

$isolationSupervisorProgramSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorProgram
$isolationSupervisorOptionsSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorOptions
$isolationSupervisorIdentitySource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorIdentity
$isolationSupervisorPipeBoundarySource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorPipeBoundary
$isolationSupervisorDriverSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorDriver
$isolationSupervisorV3ProtocolSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorV3Protocol
$isolationSupervisorV3SessionSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorV3Session
$isolationSupervisorV3TransportSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorV3Transport
$isolationSupervisorV3ProcessLeaseSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorV3ProcessLease
$isolationSupervisorV3TestSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorV3Tests
$isolationSupervisorDriverContractSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorDriverContracts
$isolationSupervisorDriverAttestationValidatorSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorDriverAttestationValidator
$isolationSupervisorEngineSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorEngine
$isolationSupervisorRuntimeMeasurementSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorRuntimeMeasurement
$isolationSupervisorHostPostureSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorHostPosture
$isolationSupervisorVerificationKeySource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorVerificationKeys
$isolationSupervisorSignerSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorSigner
$isolationSupervisorProcessBoundarySource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorProcessBoundary
$isolationSupervisorRestrictedTokenSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorRestrictedToken
$isolationSupervisorJournalSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorJournal
$isolationSupervisorJournalProtectionSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorJournalProtection
$isolationSupervisorKillSwitchSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorKillSwitch
$isolationSupervisorTestSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorTests
$isolationSupervisorBoundaryTestSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorBoundaryTests
$isolationSupervisorDriverAttestationTestSource = Get-Content -Raw -LiteralPath `
  $isolationSupervisorDriverAttestationTests

foreach ($requiredIdentityBoundary in @(
    'Itemba Msaidizi Privileged Command Supervisor',
    'S-1-5-80-1792805186-3282615177-1795010573-3676175622-4117989893',
    'Itemba Msaidizi Companion',
    'S-1-5-80-341263411-3719254221-1864525750-3877438856-2718495063'
  )) {
  if ($isolationSupervisorIdentitySource -notmatch
      [regex]::Escape($requiredIdentityBoundary)) {
    $problems.Add(
      "Fixed privileged-command supervisor identity is missing $requiredIdentityBoundary.")
  }
}
foreach ($requiredSafeOffBoundary in @(
    'if (!configured.Enabled)',
    'builder.Services.AddHostedService<DisabledSupervisorWorker>()',
    'await builder.Build().RunAsync()',
    'configured.Validate()',
    'TrustedKillSwitch.IsEngaged(configured.KillSwitchPath)',
    'ValidateServiceIdentity(configured.SupervisorServiceSid)',
    'ProcessIdentityAccessPolicy.GrantFixedCompanionIdentityRead()',
    'RuntimeMeasurementVerifier.VerifyTrustedDirectory(configured.StateRoot)',
    'RuntimeMeasurementVerifier.VerifyCurrentExecutable(',
    'WindowsKernelIsolationDriverClient',
    'IsolationKillSwitchMonitor',
    'NamedPipeIsolationSupervisorServer'
  )) {
  if ($isolationSupervisorProgramSource -notmatch
      [regex]::Escape($requiredSafeOffBoundary)) {
    $problems.Add(
      "Privileged-command supervisor host is missing $requiredSafeOffBoundary.")
  }
}
Assert-LiteralOrder -Source $isolationSupervisorProgramSource `
  -Description 'Privileged-command supervisor safe-off startup' -Literals @(
    'if (!configured.Enabled)',
    'builder.Services.AddHostedService<DisabledSupervisorWorker>()',
    'await builder.Build().RunAsync()',
    'return;',
    'configured.Validate()',
    'ValidateServiceIdentity(configured.SupervisorServiceSid)',
    'RuntimeMeasurementVerifier.VerifyCurrentExecutable(',
    'WindowsKernelIsolationDriverClient',
    'NamedPipeIsolationSupervisorServer'
  )
foreach ($requiredServiceTokenBoundary in @(
    'WellKnownSidType.LocalSystemSid',
    'identity.Groups.Contains(fixedServiceSid)',
    'RestrictedServiceTokenValidator.IsRestrictedTo(',
    'Process.GetCurrentProcess().SessionId != 0'
  )) {
  if ($isolationSupervisorProgramSource -notmatch
      [regex]::Escape($requiredServiceTokenBoundary)) {
    $problems.Add(
      "Privileged-command restricted-service host is missing $requiredServiceTokenBoundary.")
  }
}
foreach ($requiredOptionBoundary in @(
    'ReservationLeaseSigningKey',
    'PreBindReservationReleaseSigningKey',
    'SuspendedProcessBindAcknowledgementSigningKey',
    'TerminalEnforcementReceiptSigningKey',
    'ActionTokenVerificationKey',
    'DriverAttestationVerificationKey',
    'PrivilegedCommandIsolationActionTokenTrust.Issuer',
    'PrivilegedCommandIsolationActionTokenTrust.Audience',
    'PrivilegedCommandIsolationActionTokenTrust.Subject',
    'MaximumInvocationTimeoutSeconds',
    'MaximumInvocationOutputBytes',
    'MaximumInvocationProcesses',
    'MaximumInvocationProcessMemoryBytes',
    'SubjectPublicKeyInfoBase64',
    'Distinct(StringComparer.Ordinal).Count() != signingKeys.Length',
    'CanonicalP256Spki(',
    'SupervisorServiceIdentity.RequiredServiceSid',
    'SupervisorServiceIdentity.RequiredCompanionServiceSid',
    'expectedKillSwitch',
    'string.Equals(journal, expectedJournal'
  )) {
  if ($isolationSupervisorOptionsSource -notmatch
      [regex]::Escape($requiredOptionBoundary)) {
    $problems.Add(
      "Privileged-command supervisor options are missing $requiredOptionBoundary.")
  }
}
foreach ($requiredPipeBoundary in @(
    'FirstInstanceClaims',
    'FileFlagFirstPipeInstance',
    'PipeRejectRemoteClients',
    'D:P(A;;GA;;;SY)(A;;GA;;;',
    'GetNamedPipeClientProcessId(',
    'ProcessIdToSessionId(',
    'ProcessQueryInformation | Synchronize',
    'GenericRead | FileExecute | Synchronize',
    'OpenAndBindMappedImage(process, expectedPath)',
    'ProcessImageFileMapping',
    'information.NumberOfLinks != 1',
    'GetFinalPath(handle)',
    'SHA256.HashData(imageLock)',
    'GetProcessTimes(',
    'RestrictedServiceTokenValidator.IsRestrictedTo(token, serviceSid)'
  )) {
  if ($isolationSupervisorPipeBoundarySource -notmatch
      [regex]::Escape($requiredPipeBoundary)) {
    $problems.Add(
      "Privileged-command supervisor pipe is missing $requiredPipeBoundary.")
  }
}
foreach ($requiredTokenRestriction in @(
    'IsTokenRestricted(token)',
    'TokenRestrictedSids',
    'GetTokenInformation(',
    'new SecurityIdentifier(item.Sid).Equals(requiredServiceSid)'
  )) {
  if ($isolationSupervisorRestrictedTokenSource -notmatch
      [regex]::Escape($requiredTokenRestriction)) {
    $problems.Add(
      "Privileged-command restricted-token proof is missing $requiredTokenRestriction.")
  }
}
foreach ($requiredProcessBoundary in @(
    'ProcessQueryInformation | Synchronize',
    'SetSecurityInfo(',
    'GetEffectiveRightsFromAcl(',
    'AccessMode = AccessMode.SetAccess',
    'IsExactPeerAceSet(',
    'effectiveRights != ExactPeerRights'
  )) {
  if ($isolationSupervisorProcessBoundarySource -notmatch
      [regex]::Escape($requiredProcessBoundary)) {
    $problems.Add(
      "Privileged-command reciprocal process boundary is missing $requiredProcessBoundary.")
  }
}
foreach ($requiredDriverBoundary in @(
    'RuntimeMeasurementVerifier.VerifyDriverImage(',
    'NetworkIsolationDriverSessionV3',
    'UnavailableV3SignedDriverAttestationSource',
    'SignedDriverAttestationValidator.Validate(',
    'CryptographicOperations.ZeroMemory(nonce)',
    'PrivilegedCommandIsolationInvocationV2 invocation',
    'ImageVolumeSerialNumber',
    'CommandLineSha256',
    'EnvironmentBlockSha256',
    'PrivilegedCommandIsolationFeatures.Required',
    'EnsureDenyAllPolicyAsync(',
    'EnrollProcessAsync(',
    'RemoveProcessAsync(',
    'KillAsync('
  )) {
  if ($isolationSupervisorDriverSource -notmatch
      [regex]::Escape($requiredDriverBoundary)) {
    $problems.Add(
      "Privileged-command kernel driver client is missing $requiredDriverBoundary.")
  }
}
foreach ($requiredV3ProtocolBoundary in @(
    'Version = 3',
    'IoctlGetProtocol = 0x0022E040',
    'IoctlGetHealth = 0x0022E044',
    'IoctlReplacePolicy = 0x0022E048',
    'IoctlEnrollProcess = 0x0022E04C',
    'IoctlRemoveProcess = 0x0022E050',
    'IoctlSetKillState = 0x0022E054',
    'MessageRequestSequenceOffset = 16',
    'PolicyEntriesOffset = 112',
    'EnrollmentImagePathOffset = 168',
    'EnrollmentAppIdOffset = 1_208',
    'BinaryPrimitives.WriteUInt64LittleEndian',
    'ReadAndValidateHeader(',
    'CryptographicOperations.FixedTimeEquals',
    'MSAIDIZI-NETWORK-PROCESS-IDENTITY-V1\0',
    'MSAIDIZI-NETWORK-POLICY-V1\0',
    'MSAIDIZI-NETWORK-DRIVER-HEALTH-V1\0'
  )) {
  if ($isolationSupervisorV3ProtocolSource -notmatch
      [regex]::Escape($requiredV3ProtocolBoundary)) {
    $problems.Add(
      "Privileged-command managed v3 ABI is missing $requiredV3ProtocolBoundary.")
  }
}
foreach ($requiredV3SessionBoundary in @(
    'LastAcceptedRequestSequence',
    'StatusReplay',
    'StatusStaleGeneration',
    'TryGetSuccessfulMutation(',
    'HealthDriverMeasurementProvisioned',
    'HealthBootMeasurementProvisioned',
    'HealthKillActive',
    'HealthUnloading',
    'SetKillState'
  )) {
  if ($isolationSupervisorV3SessionSource -notmatch
      [regex]::Escape($requiredV3SessionBoundary)) {
    $problems.Add(
      "Privileged-command managed v3 session is missing $requiredV3SessionBoundary.")
  }
}
foreach ($requiredV3TransportBoundary in @(
    'FileFlagOverlapped',
    'DeviceIoControl(',
    'CancelIoEx(',
    '_device.Dispose()',
    'operation.Completion.WaitAsync(timeout.Token)',
    'TaskContinuationOptions.ExecuteSynchronously'
  )) {
  if ($isolationSupervisorV3TransportSource -notmatch
      [regex]::Escape($requiredV3TransportBoundary)) {
    $problems.Add(
      "Privileged-command managed v3 transport is missing $requiredV3TransportBoundary.")
  }
}
foreach ($requiredV3ProcessBoundary in @(
    'ProcessTelemetryIdInformation',
    'GetProcessTimes(',
    'GetFileInformationByHandle(',
    'SHA256.HashData(file)',
    'FileShare.Read',
    'RequireWfpApplicationIdMatches(',
    'FwpmGetAppIdFromFileName0',
    'JobObjectLimitKillOnJobClose',
    'AssignProcessToJobObject(',
    'TerminateJobObject(',
    '_executableIdentity.Dispose()'
  )) {
  if ($isolationSupervisorV3ProcessLeaseSource -notmatch
      [regex]::Escape($requiredV3ProcessBoundary)) {
    $problems.Add(
      "Privileged-command managed v3 process lease is missing $requiredV3ProcessBoundary.")
  }
}
foreach ($requiredV3Regression in @(
    'ManagedAbiMatchesFrozenNativeHeaderAndPortableAssertions',
    'CanonicalFramesUseExactOffsetsAndLittleEndianScalars',
    'BinaryBindSettleAndHealthAreMonotonicAndIdempotent',
    'DriverReplayOrStaleGenerationTripsTheSessionWithoutRetry',
    'KillUsesOutOfBandGenerationAndLatchesTheSession',
    'InvalidHealthChallengeFailsClosed',
    'HighLevelBindAndSettleMapToV3AndKeepSignedAttestationMandatory',
    'MissingSignedV3AttestationSourceRejectsAfterBinaryHealth',
    'ExecutableIdentityLockBlocksReplacementAndDetectsPostReleaseDrift'
  )) {
  if ($isolationSupervisorV3TestSource -notmatch
      [regex]::Escape($requiredV3Regression)) {
    $problems.Add(
      "Privileged-command managed v3 regressions are missing $requiredV3Regression.")
  }
}
if ($isolationSupervisorDriverSource -match
    '0x00222000|0x00222004|0x00222008|0x0022200C') {
  $problems.Add(
    'Privileged-command production client must not dispatch legacy JSON v2 IOCTLs.')
}
foreach ($requiredDriverAttestationBoundary in @(
    'PrivilegedCommandIsolationCanonical.VerifyDriverAttestation(',
    'PrivilegedCommandIsolationSignaturePurposes.DriverAttestation',
    'evidence.ChallengeNonceSha256',
    'options.DriverAttestationVerificationKey.KeyId',
    'evidence.BootId',
    'evidence.PolicyEpoch',
    'evidence.DriverServiceName',
    'evidence.DriverImagePathSha256',
    'evidence.SecureBootEnabled',
    'evidence.HvciEnabled',
    'evidence.WdacEnforced',
    'evidence.ExpiresAtUnixMilliseconds - evidence.IssuedAtUnixMilliseconds'
  )) {
  if ($isolationSupervisorDriverAttestationValidatorSource -notmatch
      [regex]::Escape($requiredDriverAttestationBoundary)) {
    $problems.Add(
      "Signed isolation driver attestation is missing $requiredDriverAttestationBoundary.")
  }
}
foreach ($requiredHostPostureBoundary in @(
    'ServiceController(serviceName)',
    'ServiceType.KernelDriver',
    'SYSTEM\CurrentControlSet\Services\',
    'IsExactLoadedDriver(expected)',
    'GetFirmwareEnvironmentVariable(',
    'HypervisorEnforcedCodeIntegrity',
    'NtQuerySystemInformation(',
    'HvciEnforced(codeIntegrity)',
    'WdacEnforced(codeIntegrity)'
  )) {
  if ($isolationSupervisorHostPostureSource -notmatch
      [regex]::Escape($requiredHostPostureBoundary)) {
    $problems.Add(
      "Live isolation host posture is missing $requiredHostPostureBoundary.")
  }
}
foreach ($requiredRuntimeMeasurement in @(
    'IsExactMappedImage(process, stream.SafeFileHandle)',
    'ProcessImageFileMapping',
    'information.NumberOfLinks != 1',
    'GetFinalPath(handle)',
    'GenericRead | FileExecute | Synchronize'
  )) {
  if ($isolationSupervisorRuntimeMeasurementSource -notmatch
      [regex]::Escape($requiredRuntimeMeasurement)) {
    $problems.Add(
      "Mapped supervisor self-measurement is missing $requiredRuntimeMeasurement.")
  }
}
foreach ($requiredVerificationKeyBoundary in @(
    'PinnedActionTokenVerificationKeyResolver',
    'PinnedDriverAttestationVerificationKeyResolver',
    'StoreName.TrustedPeople',
    'StoreLocation.LocalMachine',
    'matches.Count != 1 || matches[0].HasPrivateKey',
    'CryptographicOperations.FixedTimeEquals('
  )) {
  if ($isolationSupervisorVerificationKeySource -notmatch
      [regex]::Escape($requiredVerificationKeyBoundary)) {
    $problems.Add(
      "Pinned isolation verification keys are missing $requiredVerificationKeyBoundary.")
  }
}
foreach ($requiredDriverContract in @(
    'RequireExactAttestation(',
    'RequireBinding(',
    'RequireTerminal(',
    'features.SequenceEqual(PrivilegedCommandIsolationFeatures.Required',
    '!binding.ChildStillSuspended',
    '!binding.AssignedToJob',
    '!binding.KernelEnforcementActive',
    '!evidence.ProcessTreeTerminal'
  )) {
  if ($isolationSupervisorDriverContractSource -notmatch
      [regex]::Escape($requiredDriverContract)) {
    $problems.Add(
      "Privileged-command kernel evidence contract is missing $requiredDriverContract.")
  }
}
foreach ($requiredSignerBoundary in @(
    'PurposeSigningKey _reservationLeaseKey',
    'PurposeSigningKey _preBindReleaseKey',
    'PurposeSigningKey _bindAcknowledgementKey',
    'PurposeSigningKey _terminalReceiptKey',
    'SignReservationLease(',
    '_reservationLeaseKey.KeyId',
    'SignPreBindRelease(',
    '_preBindReleaseKey.KeyId',
    'SignBindAcknowledgement(',
    '_bindAcknowledgementKey.KeyId',
    'SignTerminalReceipt(',
    '_terminalReceiptKey.KeyId',
    'CngProvider.MicrosoftPlatformCryptoProvider.Provider',
    'privateKey.Key.ExportPolicy != CngExportPolicies.None',
    'binding.SubjectPublicKeyInfoBase64',
    'CryptographicOperations.ZeroMemory(spki)',
    'key.GetProperty("Security Descr", (CngPropertyOptions)0x4)',
    'descriptor.DiscretionaryAcl.Count != 1',
    'ace.AccessMask != GenericAll'
  )) {
  if ($isolationSupervisorSignerSource -notmatch
      [regex]::Escape($requiredSignerBoundary)) {
    $problems.Add(
      "Purpose-separated isolation signer is missing $requiredSignerBoundary.")
  }
}
foreach ($requiredJournalBoundary in @(
    'Single-writer, write-through, hash-chained supervisor ledger',
    'command text, output,',
    'tokens, credentials, and model content never enter this file',
    'bool requirePreprovisionedFiles = true',
    'new WindowsIsolationJournalProtection()',
    'protection.ValidatePreOpen(directory, fullPath, lockPath)',
    'requirePreprovisionedFiles ? FileMode.Open : FileMode.OpenOrCreate',
    'FileShare.None',
    'FileShare.Read',
    'FileOptions.WriteThrough | FileOptions.SequentialScan',
    'ValidateFileHandle(_ownershipLock.SafeFileHandle, lockPath',
    'ValidateFileHandle(_stream.SafeFileHandle, fullPath',
    'protection?.ValidateOpened(',
    '_stream.Flush(flushToDisk: true)',
    'The isolation journal sequence is stale.',
    'The isolation journal hash chain is discontinuous.',
    'information.NumberOfLinks != 1',
    'FileAttributeReparsePoint',
    'GetFinalPath(handle)'
  )) {
  if ($isolationSupervisorJournalSource -notmatch
      [regex]::Escape($requiredJournalBoundary)) {
    $problems.Add(
      "Privileged-command durable lifecycle journal is missing $requiredJournalBoundary.")
  }
}
foreach ($requiredJournalProtection in @(
    'Itemba Msaidizi Recovery Operators',
    'SupervisorServiceIdentity.RequiredServiceSid',
    'AccessControlSections.Owner | AccessControlSections.Access',
    'SetAccessRuleProtection(isProtected: true, preserveInheritance: false)',
    'FileSystemRights.FullControl',
    'FileSystemRights.Modify',
    'FileSystemRights.ReadAndExecute',
    'InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit',
    'actual.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclProtected)',
    'actual.GetSddlForm(AccessControlSections.Access)',
    'EnsureNoReparsePoints(journalPath)',
    'EnsureNoReparsePoints(lockPath)'
  )) {
  if ($isolationSupervisorJournalProtectionSource -notmatch
      [regex]::Escape($requiredJournalProtection)) {
    $problems.Add(
      "Privileged-command journal ACL protection is missing $requiredJournalProtection.")
  }
}
foreach ($requiredKillSwitchBoundary in @(
    'if (string.IsNullOrWhiteSpace(path))',
    'MarkerParentIsPresentAndOrdinary(path)',
    'catch (DirectoryNotFoundException)',
    'FileAttributes.ReparsePoint'
  )) {
  if ($isolationSupervisorKillSwitchSource -notmatch
      [regex]::Escape($requiredKillSwitchBoundary)) {
    $problems.Add(
      "Privileged-command trusted-root kill switch is missing $requiredKillSwitchBoundary.")
  }
}
foreach ($requiredEngineBoundary in @(
    'InitializeAndRecoverAsync(',
    'ThrowIfKillSwitchEngaged()',
    'await RequireAttestationAsync(cancellationToken)',
    'RecoverBindCoreAsync(state, cancellationToken)',
    'ReserveAsync(',
    '_actionTokenVerifier.VerifyAsync(',
    'ActionRequestAuthorizer.Validate(',
    'PrivilegedCommandIsolationCanonical.IsValidReservationRequest(request)',
    'ValidateExactAuthorization(',
    'authorization.IdempotencyKeySha256',
    'PayloadDigest.Sha256Hex(actionRequest.IdempotencyKey)',
    'PrivilegedCommandIsolationCanonical.InvocationSha256(invocation)',
    'InvocationMatchesSignedArguments(actionRequest, invocation)',
    'invocation.MaximumProcesses != _options.MaximumInvocationProcesses',
    'invocation.MaximumProcessMemoryBytes',
    'claims.ExpiresAtUnixSeconds * 1_000L',
    'claims.LeaseExpiresAtUnixSeconds * 1_000L',
    'An expired isolation reservation lease cannot be replayed.',
    'ReleaseAsync(',
    'BindAsync(',
    'KernelIsolationValidation.RequireBinding(enforcement)',
    'ValidateKernelBinding(',
    'SettleAsync(',
    'KernelIsolationValidation.RequireTerminal(evidence)',
    'RecoverAndTerminateAsync(',
    'Interlocked.Exchange(ref _unsafe, 1)',
    'trusted_root_kill_switch_engaged'
  )) {
  if ($isolationSupervisorEngineSource -notmatch
      [regex]::Escape($requiredEngineBoundary)) {
    $problems.Add(
      "Privileged-command isolation engine is missing $requiredEngineBoundary.")
  }
}
if ([regex]::Matches(
    $isolationSupervisorEngineSource,
    [regex]::Escape('await RequireAttestationAsync(cancellationToken)')).Count -lt 3) {
  $problems.Add(
    'The isolation supervisor must freshly attest at startup, reservation, and immediately before kernel bind.')
}
if ($isolationSupervisorEngineSource -match
    'Process\.Start\s*\(|\bCreateProcess(?:AsUser|WithToken|Native)?\s*\(|' +
    'ShellExecute|System\.Management\.Automation|Runspace|WScript|CScript') {
  $problems.Add(
    'The isolation supervisor policy verifier must not contain any command execution API.')
}
foreach ($requiredFixedInvocationPolicy in @(
    '"cmd" => Path.Combine(system32, "cmd.exe")',
    '"windows-powershell" => Path.Combine(',
    '"WindowsPowerShell"',
    '"powershell.exe"',
    'invocation.WorkingDirectory,',
    'expectedEnvironment.TryGetValue(variable.Name, out var value)'
  )) {
  if ($isolationSupervisorEngineSource -notmatch
      [regex]::Escape($requiredFixedInvocationPolicy)) {
    $problems.Add(
      "Fixed System32 invocation policy is missing $requiredFixedInvocationPolicy.")
  }
}
foreach ($requiredBoundaryRegression in @(
    'PackagedConfigurationCanRemainStableAndSafeOff',
    'EnabledConfigurationRejectsUnprovisionedIdentityAndPins',
    'CompleteActiveConfigurationIsAccepted',
    'ActiveConfigurationCannotSelectAnotherSupervisorServiceSid',
    'ActiveConfigurationCannotSelectAnotherCompanionServiceSid',
    'ActiveConfigurationCannotMoveKillSwitchOutsideSharedTrustedRoot',
    'TrustedKillSwitchFailsClosedWhenItsTrustedRootDisappears',
    'SigningKeyAclAllowsOnlyTheFixedSupervisorServiceSid',
    'ActiveConfigurationRequiresFourDistinctCanonicalP256PurposeKeys',
    'ProcessPeerGrantRejectsBroaderDuplicateCallbackAndObjectAces',
    'WireKindsRemainExactlyCompatibleWithCompanionClientV2',
    'PipeFactoryRequiresRemoteRejectionAndAProcessOwnedFirstInstance',
    'PeerAndSelfMeasurementsBindRetainedFilesToMappedProcessImages',
    'JournalPermitsOnlyOneWriterProcess'
  )) {
  if ($isolationSupervisorBoundaryTestSource -notmatch
      [regex]::Escape($requiredBoundaryRegression)) {
    $problems.Add(
      "Privileged-command supervisor boundary tests are missing $requiredBoundaryRegression.")
  }
}
foreach ($requiredEngineRegression in @(
    'ExactLifecycleIsSignedVerifiedAndIdempotent',
    'ReleaseIsMutuallyExclusiveWithBindAndExactOnReplay',
    'RestartRecoversAndTerminatesExactBoundTreeBeforeNewDispatch',
    'RestartReleasesPendingReservationBeforeServingRecovery',
    'DriverUnavailableFailsBeforeAnyReservationIsIssued',
    'SharedKillSwitchStopsBeforeDriverOrJournalAccess',
    'DriverLossAfterStartupFencesBeforeReservationCommit',
    'ParentCreationIdentityMismatchNeverReachesKernelBind',
    'UncertainKernelBindOutcomeTripsFatalFenceWithoutDurableBind',
    'SettlementTransportLossLeavesExactBindPendingAndTripsFatalFence',
    'TerminalMismatchCommitsSignedViolationAndFencesFutureDispatch',
    'InvalidActionTokenSignatureIsRejectedBeforeReservation',
    'EverySignedAuthorizationClaimMutationIsRejected',
    'InvalidCanonicalAuthorizationShapeIsRejectedBeforeReservation',
    'BindAfterSignedAuthorizationLifetimeNeverReachesKernel',
    'ExpiredIdempotentReservationReplayIsExplicitlyRejected',
    'AttestationLossBetweenReserveAndBindFailsSafeBeforeKernelDispatch',
    'DurableJournalNeverContainsCompactTokenArgvOrEnvironment',
    'CanonicalInvocationMutationIsRejectedBeforeReservation',
    'CompanionObservationMutationIsRejectedBeforeKernelBind',
    'IndependentDriverMeasurementMutationFencesKernelBind',
    'HashChainTamperFailsClosedOnReload',
    'TornJournalTailFailsClosedOnReload'
  )) {
  if ($isolationSupervisorTestSource -notmatch
      [regex]::Escape($requiredEngineRegression)) {
    $problems.Add(
      "Privileged-command supervisor engine tests are missing $requiredEngineRegression.")
  }
}
foreach ($requiredAttestationRegression in @(
    'ValidPinnedPurposeNonceBootPolicyAndPostureAttestationPasses',
    'EverySignedAndLiveAttestationTrustMutationFailsClosed'
  )) {
  if ($isolationSupervisorDriverAttestationTestSource -notmatch
      [regex]::Escape($requiredAttestationRegression)) {
    $problems.Add(
      "Signed driver-attestation tests are missing $requiredAttestationRegression.")
  }
}

$actionExecutionCoordinatorTestSource = Get-Content -Raw -LiteralPath `
  $actionExecutionCoordinatorTests
if ($actionExecutionCoordinatorTestSource -notmatch
    [regex]::Escape('IsolationUnsafeFailurePersistsNeedsAttentionThenEscapesCoordinator')) {
  $problems.Add(
    'Coordinator tests must prove isolation ambiguity is persisted as NEEDS_ATTENTION before escaping the worker.')
}

$governedSystemCommandSource = Get-Content -Raw -LiteralPath $governedSystemCommandBoundary
foreach ($requiredBoundary in @(
    'Environment.SystemDirectory',
    'OpenSystemExecutablePath',
    'EnsureHandleStillNames',
    'VolumeSerialNumber',
    'FileId',
    'CreateSuspended',
    'CreateProcessNative',
    'ValidateProcessImage',
    'ProcThreadAttributeHandleList',
    'AssignProcessToJobObject',
    'JobObjectLimitKillOnJobClose',
    'ResumeThread',
    'TerminateJobObject',
    'Interlocked.Add',
    'maximumOutputBytes'
  )) {
  if ($governedSystemCommandSource -notmatch [regex]::Escape($requiredBoundary)) {
    $problems.Add("Governed system-command boundary is missing $requiredBoundary.")
  }
}
if ($governedSystemCommandSource -match
    'Process\.Start|UseShellExecute|System\.Management\.Automation|Runspace|ShellExecute') {
  $problems.Add(
    'Governed system-command boundary must use only its exact native suspended-launch path.')
}
$governedCreateCalls = [regex]::Matches(
  $governedSystemCommandSource,
  '\bCreateProcessNative\s*\(')
if ($governedCreateCalls.Count -ne 2) {
  $problems.Add(
    'Governed system-command boundary must have one CreateProcessNative call and one declaration.')
}
$governedCreateIndex = $governedSystemCommandSource.IndexOf(
  'CreateProcessNative(',
  [StringComparison]::Ordinal)
$governedImageIndex = $governedSystemCommandSource.IndexOf(
  'ValidateProcessImage(',
  [StringComparison]::Ordinal)
$governedJobIndex = $governedSystemCommandSource.IndexOf(
  'AssignProcessToJobObject(',
  [StringComparison]::Ordinal)
$governedResumeIndex = $governedSystemCommandSource.IndexOf(
  'ResumeThread(',
  [StringComparison]::Ordinal)
if ($governedCreateIndex -lt 0 -or $governedImageIndex -le $governedCreateIndex `
    -or $governedJobIndex -le $governedImageIndex `
    -or $governedResumeIndex -le $governedJobIndex) {
  $problems.Add(
    'Governed system tools must be created suspended, image-verified, Job-assigned, then resumed.')
}
$governedSystemCommandTestSource = Get-Content -Raw -LiteralPath $governedSystemCommandTests
foreach ($requiredTest in @(
    'CancellationTerminatesTheEntireDescendantTree',
    'RunnerDisposalTerminatesTheEntireDescendantTree',
    'StandardOutputAndErrorShareOneAggregateByteCeiling'
  )) {
  if ($governedSystemCommandTestSource -notmatch [regex]::Escape($requiredTest)) {
    $problems.Add("Governed system-command tests are missing $requiredTest.")
  }
}

$companionProgramSource = Get-Content -Raw -LiteralPath (
  Join-Path $companionRoot 'src\Msaidizi.Companion.Service\Program.cs')
$recoveryProgramSource = Get-Content -Raw -LiteralPath (
  Join-Path $companionRoot 'src\Msaidizi.RecoverySupervisor\Program.cs')
$journaledRecoverySource = Get-Content -Raw -LiteralPath (
  Join-Path $companionRoot `
    'src\Msaidizi.Companion.Service\Capabilities\JournaledHostRecoveryVault.cs')
foreach ($requiredBoundary in @(
    'AddSingleton<IEgressBoundaryClient>(services =>',
    'EgressBoundaryClientFactory.Create(',
    'AddSingleton<IEgressReceiptReplayStore>(services =>',
    'new FileEgressReceiptReplayStore(',
    'requireInstallerBoundary: true',
    'AddSingleton<EgressBoundaryDispatchLatch>()',
    'AddHostedService<EgressReceiptReplayStartupVerifier>()',
    'AddSingleton<ILocalSystemEgressEvidenceVerifier,',
    'LocalSystemEgressEvidenceVerifier>()'
  )) {
  if ($companionProgramSource -notmatch [regex]::Escape($requiredBoundary)) {
    $problems.Add("Companion egress replay DI is missing $requiredBoundary.")
  }
}
Assert-LiteralOrder -Source $companionProgramSource `
  -Description 'Companion fail-closed egress replay startup registration' -Literals @(
    'AddSingleton<IEgressBoundaryClient>(services =>',
    'EgressBoundaryClientFactory.Create(',
    'AddSingleton<IEgressReceiptReplayStore>(services =>',
    'AddSingleton<EgressBoundaryDispatchLatch>()',
    'AddHostedService<EgressReceiptReplayStartupVerifier>()',
    'AddSingleton<ILocalSystemEgressEvidenceVerifier,',
    'AddHostedService<CompanionWorker>()'
  )
foreach ($requiredBoundary in @(
    'AddSingleton<FileHostRecoveryVault>()',
    'AddSingleton<JournaledHostRecoveryVault>()',
    'GetRequiredService<JournaledHostRecoveryVault>()',
    'GetRequiredService<FileHostRecoveryVault>()'
  )) {
  if ($companionProgramSource -notmatch [regex]::Escape($requiredBoundary)) {
    $problems.Add("Companion recovery DI is missing $requiredBoundary.")
  }
}
foreach ($requiredBoundary in @(
    'AddSingleton<GovernedSystemToolRunner>()'
  )) {
  if ($companionProgramSource -notmatch [regex]::Escape($requiredBoundary) `
      -or $recoveryProgramSource -notmatch [regex]::Escape($requiredBoundary)) {
    $problems.Add(
      "Companion and recovery services must both register $requiredBoundary.")
  }
}
foreach ($requiredBoundary in @(
    'PrivilegedCommandIsolationClientFactory.Register(builder.Services)',
    'AddSingleton<RejectingPrivilegedCommandTrustedRootIsolationGate>()',
    'AddSingleton<IPrivilegedCommandTrustedRootIsolationGate>(provider =>',
    'RejectingPrivilegedCommandTrustedRootIsolationGate>()',
    'AddSingleton<IPrivilegedCommandTrustedRootIsolationRecovery>(provider =>',
    '(IPrivilegedCommandTrustedRootIsolationRecovery)provider.GetRequiredService<',
    'return TryCreate(options, companion, out var client) ? client! : fallback',
    'out NamedPipePrivilegedCommandTrustedRootIsolationClient? client',
    'new ExactPurposeP256PublicKeyResolver(pins)',
    'new PrivilegedCommandIsolationContractVerifier(verification, resolver)',
    'new NamedPipePrivilegedCommandTrustedRootIsolationClient(',
    'ExpectedSupervisorServiceSid = options.ExpectedSupervisorServiceSid',
    'TrustedSupervisorProcessAccessGrant.IsCanonicalRestrictedServiceSid(',
    'options.ExpectedDeviceId',
    'companion.DeviceId',
    'Distinct(StringComparer.Ordinal).Count() != 4',
    'AddSingleton<IPrivilegedCommandIsolationReplayStore>(services =>',
    'new FilePrivilegedCommandIsolationReplayStore(',
    '.Value.IsolationReplayStorePath',
    'AddSingleton<PrivilegedCommandIsolationDispatchLatch>()',
    'AddHostedService<PrivilegedCommandIsolationStartupReconciler>()',
    'AddSingleton<PrivilegedOwnedCommandRunner>()'
  )) {
  if ($companionProgramSource -notmatch [regex]::Escape($requiredBoundary)) {
    $problems.Add("Companion privileged-command isolation DI is missing $requiredBoundary.")
  }
}
if ($recoveryProgramSource -match 'JournaledHostRecoveryVault' `
    -or $recoveryProgramSource -notmatch 'GetRequiredService<FileHostRecoveryVault>') {
  $problems.Add(
    'Recovery supervisor must retain the bare trusted FileHostRecoveryVault reader.')
}
$isolationRegistrations = [regex]::Matches(
  $companionProgramSource,
  [regex]::Escape('AddSingleton<IPrivilegedCommandTrustedRootIsolationGate>(provider =>'))
if ($isolationRegistrations.Count -ne 1) {
  $problems.Add(
    'Companion DI must contain exactly one privileged-command isolation registration.')
}
$isolationFactoryCalls = [regex]::Matches(
  $companionProgramSource,
  [regex]::Escape('PrivilegedCommandIsolationClientFactory.Register(builder.Services)'))
if ($isolationFactoryCalls.Count -ne 1) {
  $problems.Add(
    'Companion DI must invoke the fail-closed privileged-command client factory exactly once.')
}
$isolationRecoveryRegistrations = [regex]::Matches(
  $companionProgramSource,
  [regex]::Escape('AddSingleton<IPrivilegedCommandTrustedRootIsolationRecovery>(provider =>'))
if ($isolationRecoveryRegistrations.Count -ne 1) {
  $problems.Add(
    'Companion DI must contain exactly one settlement-only privileged-command recovery registration.')
}
$replayStoreRegistrations = [regex]::Matches(
  $companionProgramSource,
  [regex]::Escape('AddSingleton<IPrivilegedCommandIsolationReplayStore>(services =>'))
if ($replayStoreRegistrations.Count -ne 1) {
  $problems.Add(
    'Companion DI must contain exactly one durable privileged-command replay-store registration.')
}
$replayStoreProgramReferences = [regex]::Matches(
  $companionProgramSource,
  '\bFilePrivilegedCommandIsolationReplayStore\b')
if ($replayStoreProgramReferences.Count -ne 1) {
  $problems.Add(
    'Companion DI must construct the durable privileged-command replay store exactly once.')
}
Assert-LiteralOrder -Source $companionProgramSource `
  -Description 'Companion privileged-command production registration' -Literals @(
    'AddSingleton<PrivilegedCommandIsolationDispatchLatch>()',
    'PrivilegedCommandIsolationClientFactory.Register(builder.Services)',
    'AddSingleton<IPrivilegedCommandIsolationReplayStore>(services =>',
    'new FilePrivilegedCommandIsolationReplayStore(',
    'AddHostedService<PrivilegedCommandIsolationStartupReconciler>()',
    'AddSingleton<PrivilegedOwnedCommandRunner>()'
  )
Assert-LiteralOrder -Source $companionProgramSource `
  -Description 'Fail-closed privileged-command client factory registration' -Literals @(
    'AddSingleton<RejectingPrivilegedCommandTrustedRootIsolationGate>()',
    'AddSingleton<IPrivilegedCommandTrustedRootIsolationGate>(provider =>',
    'AddSingleton<IPrivilegedCommandTrustedRootIsolationRecovery>(provider =>'
  )
$isolationLatchRegistrations = [regex]::Matches(
  $companionProgramSource,
  [regex]::Escape('AddSingleton<PrivilegedCommandIsolationDispatchLatch>()'))
if ($isolationLatchRegistrations.Count -ne 1) {
  $problems.Add(
    'Companion DI must register exactly one unconditional privileged-command isolation latch.')
}
Assert-LiteralOrder -Source $companionProgramSource `
  -Description 'Default companion isolation latch registration' -Literals @(
    'AddSingleton<PrivilegedCommandIsolationDispatchLatch>()',
    'AddHostedService<CompanionWorker>()'
  )
Assert-LiteralOrder -Source $companionProgramSource `
  -Description 'Privileged recovery fences broker startup' -Literals @(
    'AddHostedService<PrivilegedCommandIsolationStartupReconciler>()',
    'AddHostedService<CompanionWorker>()'
  )
foreach ($requiredBoundary in @(
    'AppendRecoveryPreparedAsync',
    'CancellationToken.None',
    'PayloadDigest.Sha256Hex(receipt.OpaqueHandle)'
  )) {
  if ($journaledRecoverySource -notmatch [regex]::Escape($requiredBoundary)) {
    $problems.Add("Journaled recovery boundary is missing $requiredBoundary.")
  }
}
if ($journaledRecoverySource -match 'receipt\.RecordPath') {
  $problems.Add('Journaled recovery boundary must never append the raw recovery path.')
}

$visualStudioRoot = Join-Path ${env:ProgramFiles} 'Microsoft Visual Studio\2022'
$roslynDirectory = @('Community', 'Professional', 'Enterprise', 'BuildTools') |
  ForEach-Object {
    Join-Path $visualStudioRoot "$_\MSBuild\Current\Bin\Roslyn"
  } |
  Where-Object {
    Test-Path -LiteralPath (Join-Path $_ 'Microsoft.CodeAnalysis.CSharp.dll')
  } |
  Select-Object -First 1

if ($null -ne $roslynDirectory) {
  $unsafeResolver = $null
  try {
    # Windows PowerShell 5 does not apply .NET Core's assembly unification and
    # current Roslyn still asks for an older strong-named Unsafe dependency.
    # Resolve that request to the exact Visual Studio-shipped companion DLL;
    # PowerShell 7 already supplies the dependency through its runtime.
    if ($PSVersionTable.PSEdition -eq 'Desktop') {
      $unsafePath = Join-Path $roslynDirectory 'System.Runtime.CompilerServices.Unsafe.dll'
      if (Test-Path -LiteralPath $unsafePath) {
        $unsafeAssembly = [System.Reflection.Assembly]::LoadFrom($unsafePath)
        $unsafeResolver = [ResolveEventHandler] {
          param($sender, $eventArgs)
          if (([System.Reflection.AssemblyName]::new($eventArgs.Name)).Name -eq
              'System.Runtime.CompilerServices.Unsafe') {
            return $unsafeAssembly
          }
          return $null
        }
        [AppDomain]::CurrentDomain.add_AssemblyResolve($unsafeResolver)
      }
    }
    [void][System.Reflection.Assembly]::LoadFrom(
      (Join-Path $roslynDirectory 'Microsoft.CodeAnalysis.dll'))
    [void][System.Reflection.Assembly]::LoadFrom(
      (Join-Path $roslynDirectory 'Microsoft.CodeAnalysis.CSharp.dll'))
    $parseOptions = ([Microsoft.CodeAnalysis.CSharp.CSharpParseOptions]::Default).WithLanguageVersion(
      [Microsoft.CodeAnalysis.CSharp.LanguageVersion]::CSharp12)

    Get-ChildItem -LiteralPath $companionRoot -Recurse -File -Filter '*.cs' |
      Where-Object { $_.FullName -notmatch $generatedPathPattern } |
      ForEach-Object {
      $source = [System.IO.File]::ReadAllText($_.FullName)
      $tree = [Microsoft.CodeAnalysis.CSharp.CSharpSyntaxTree]::ParseText(
        $source,
        $parseOptions,
        $_.FullName)
      foreach ($diagnostic in $tree.GetDiagnostics()) {
        if ($diagnostic.Severity -eq [Microsoft.CodeAnalysis.DiagnosticSeverity]::Error) {
          $problems.Add($diagnostic.ToString())
        }
      }
    }
  }
  finally {
    if ($null -ne $unsafeResolver) {
      [AppDomain]::CurrentDomain.remove_AssemblyResolve($unsafeResolver)
    }
  }
}
else {
  if ($RequireRoslyn) {
    $problems.Add('Roslyn was not found; protected verification may not skip C# syntax parsing.')
  }
  else {
    Write-Warning 'Roslyn was not found; C# syntax parsing was skipped.'
  }
}

if ($problems.Count -gt 0) {
  $problems | ForEach-Object { Write-Error $_ }
  exit 1
}

Write-Output "Static verification passed for $($solutionProjects.Count) solution projects."
