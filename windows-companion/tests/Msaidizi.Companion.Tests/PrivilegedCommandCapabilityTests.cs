using System.Diagnostics;
using System.Globalization;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Commands;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;

namespace Itemba.Msaidizi.Companion.Tests;

public sealed class PrivilegedCommandCapabilityTests : IDisposable
{
  private readonly string _directory = Path.Combine(
    Path.GetTempPath(),
    $"privileged-command-tests-{Guid.NewGuid():N}");

  public PrivilegedCommandCapabilityTests()
  {
    Directory.CreateDirectory(_directory);
  }

  [Fact]
  public void ManifestContractIsClosedIrreversibleAndLocalSystemOnly()
  {
    var fixture = CreateFixture();
    var descriptor = fixture.Adapter.Descriptor;
    var registry = new CapabilityRegistry([fixture.Adapter]);

    Assert.Equal("command.privileged.execute", descriptor.Id);
    Assert.Equal("1.0.0", descriptor.Version);
    Assert.Equal(CapabilityDataClass.Credential, descriptor.DataClass);
    Assert.Equal(CapabilityEffect.Irreversible, descriptor.Effect);
    Assert.Equal(ConsentRequirement.OneShotApproval, descriptor.Consent);
    Assert.Equal(RecoveryKind.Irreversible, descriptor.Recovery);
    Assert.Equal(RequiredPrivilege.LocalSystem, descriptor.RequiredPrivilege);
    Assert.Equal(IdempotencySemantics.Required, descriptor.Idempotency);
    Assert.Equal(["windows-11-x64"], descriptor.SupportedOperatingSystems);
    Assert.Equal(["privileged-command-output"], descriptor.ProvenanceOutputs);
    Assert.False(descriptor.TouchesTrustedRoot);
    Assert.Contains(
      PrivilegedCommandExecuteCapabilityAdapter.UnboundedHostPreStateSha256,
      descriptor.Description,
      StringComparison.Ordinal);
    Assert.False(descriptor.ArgumentsSchema.GetProperty("additionalProperties").GetBoolean());
    Assert.False(descriptor.ResultSchema.GetProperty("additionalProperties").GetBoolean());
    Assert.Equal(descriptor, Assert.Single(registry.Descriptors));
  }

  [Fact]
  public void PolicyUsesOnlyFixedSystem32ImagesAndDeterministicEnvironment()
  {
    var fixture = CreateFixture();
    var cmd = fixture.Policy.Resolve(
      "cmd",
      ["/d", "/s", "/c", "echo hello"],
      5,
      4_096);
    var powershell = fixture.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments("[Console]::Out.Write('hello')"),
      5,
      4_096);

    Assert.Equal(
      Path.Combine(Environment.SystemDirectory, "cmd.exe"),
      cmd.ExecutablePath,
      ignoreCase: true);
    Assert.Equal(
      Path.Combine(
        Environment.SystemDirectory,
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe"),
      powershell.ExecutablePath,
      ignoreCase: true);
    Assert.Equal(Environment.SystemDirectory, cmd.WorkingDirectory, ignoreCase: true);
    Assert.Equal(
      [
        "COMSPEC",
        "OS",
        "PATH",
        "PATHEXT",
        "POWERSHELL_TELEMETRY_OPTOUT",
        "PSModulePath",
        "SystemDrive",
        "SystemRoot",
        "WINDIR",
      ],
      cmd.Environment.Keys.Order(StringComparer.OrdinalIgnoreCase));
    Assert.DoesNotContain("ProgramData", cmd.Environment.Keys, StringComparer.OrdinalIgnoreCase);
    Assert.DoesNotContain("USERPROFILE", cmd.Environment.Keys, StringComparer.OrdinalIgnoreCase);
  }

  [Theory]
  [InlineData("plain", "plain")]
  [InlineData("", "\"\"")]
  [InlineData("two words", "\"two words\"")]
  [InlineData("a\"b", "\"a\\\"b\"")]
  [InlineData("C:\\path with space\\", "\"C:\\path with space\\\\\"")]
  public void NativeArgumentQuotingPreservesEachArgvElement(string value, string expected)
  {
    Assert.Equal(expected, PrivilegedOwnedCommandRunner.QuoteArgument(value));
  }

  [Fact]
  public void InvalidArgumentsAndTrustedRootReferencesFailClosed()
  {
    var fixture = CreateFixture();
    string[] invalid =
    [
      "{\"executable\":\"pwsh\",\"argv\":[\"-c\",\"echo\"],\"timeoutSeconds\":5,\"maximumOutputBytes\":100}",
      "{\"executable\":\"cmd\",\"argv\":[\"/c\",\"echo unsafe\"],\"timeoutSeconds\":5,\"maximumOutputBytes\":100}",
      "{\"executable\":\"windows-powershell\",\"argv\":[\"-NoLogo\",\"-NoProfile\",\"-NonInteractive\",\"-ExecutionPolicy\",\"AllSigned\",\"-EncodedCommand\",\"ZQBjAGgAbwA=\"],\"timeoutSeconds\":5,\"maximumOutputBytes\":100}",
      "{\"executable\":\"cmd\",\"argv\":[\"/d\",\"/s\",\"/c\",\"type %ProgramData%\\\\Itemba\\\\Msaidizi\\\\supervisor\\\\DISABLED\"],\"timeoutSeconds\":5,\"maximumOutputBytes\":100}",
      "{\"executable\":\"cmd\",\"argv\":[\"/d\",\"/s\",\"/c\",\"echo ok\"],\"timeoutSeconds\":901,\"maximumOutputBytes\":100}",
      "{\"executable\":\"cmd\",\"argv\":[\"/d\",\"/s\",\"/c\",\"echo ok\"],\"timeoutSeconds\":5,\"maximumOutputBytes\":16777217}",
      "{\"executable\":\"cmd\",\"argv\":[\"/d\",\"/s\",\"/c\",\"echo ok\"],\"timeoutSeconds\":5,\"maximumOutputBytes\":100,\"path\":\"C:\\\\arbitrary.exe\"}",
    ];

    foreach (var json in invalid)
    {
      using var document = JsonDocument.Parse(json);
      Assert.False(fixture.Adapter.ValidateArguments(document.RootElement).IsValid);
    }
  }

  [Fact]
  public async Task AdapterReturnsBoundedDigestOnlyOutputAndIrreversibleRecoveryEvidence()
  {
    var fixture = CreateFixture();
    using var arguments = JsonDocument.Parse(
      """{"executable":"cmd","argv":["/d","/s","/c","echo hello"],"timeoutSeconds":5,"maximumOutputBytes":4096}""");

    var result = await fixture.Adapter.ExecuteAsync(
      CommandContext(),
      arguments.RootElement,
      CancellationToken.None);
    using var output = JsonDocument.Parse(result.OutputJson);

    Assert.True(fixture.Adapter.ValidateResult(output.RootElement).IsValid);
    Assert.True(result.MutationCommitted);
    Assert.True(result.OutcomeUncertain);
    Assert.Equal(
      PrivilegedCommandExecuteCapabilityAdapter.UnboundedHostPreStateSha256,
      result.PreStateSha256);
    Assert.Equal(new string('a', 64), result.RecoveryProvenanceSha256);
    Assert.Equal("opaque-recovery", result.OpaqueRecoveryHandle);
    Assert.True(output.RootElement.GetProperty("stdoutBytes").GetInt64() > 0);
    Assert.True(PayloadDigest.IsSha256Hex(
      output.RootElement.GetProperty("stdoutSha256").GetString()!));
    Assert.True(PayloadDigest.IsSha256Hex(
      output.RootElement.GetProperty("isolationPolicySha256").GetString()!));
    Assert.True(PayloadDigest.IsSha256Hex(
      output.RootElement.GetProperty("isolationAttestationSha256").GetString()!));
    Assert.False(output.RootElement.TryGetProperty("stdout", out _));
    Assert.False(output.RootElement.TryGetProperty("stderr", out _));
    var provenance = Assert.Single(result.Provenance);
    Assert.Equal("privileged-command-output", provenance.SourceType);
    Assert.Equal(ProvenanceTrust.UntrustedContent, provenance.Trust);
    Assert.True(fixture.Recovery.PreparedIrreversible);
  }

  [Trait("Category", "ProcessTiming")]
  [Fact]
  public async Task OutputCeilingKillsTheOwnedProcessTree()
  {
    var fixture = CreateFixture(maximumOutputBytes: 128);
    var specification = fixture.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments("[Console]::Out.Write(('x' * 10000)); Start-Sleep -Seconds 30"),
      10,
      128);
    var elapsed = Stopwatch.StartNew();

    await Assert.ThrowsAsync<InvalidDataException>(() => fixture.Runner.RunAsync(
      specification,
      CommandContext(maxWallTimeSeconds: 10, maxLocalBytes: 128),
      CancellationToken.None).AsTask());

    Assert.True(elapsed.Elapsed < TimeSpan.FromSeconds(5));
  }

  [Trait("Category", "ProcessTiming")]
  [Fact]
  public async Task TimeoutKillsTheOwnedProcessTree()
  {
    var fixture = CreateFixture();
    var pidFile = Path.Combine(_directory, "timeout-descendant.pid");
    var escapedPidFile = pidFile.Replace("'", "''", StringComparison.Ordinal);
    var command =
      "$p = Start-Process -PassThru -FilePath $env:COMSPEC "
      + "-ArgumentList @('/d','/s','/c','ping -n 30 127.0.0.1 >nul'); "
      + $"[IO.File]::WriteAllText('{escapedPidFile}', [string]$p.Id); $p.WaitForExit()";
    var specification = fixture.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments(command),
      5,
      4_096);
    var elapsed = Stopwatch.StartNew();

    await Assert.ThrowsAsync<TimeoutException>(() => fixture.Runner.RunAsync(
      specification,
      CommandContext(maxWallTimeSeconds: 10),
      CancellationToken.None).AsTask());

    Assert.True(elapsed.Elapsed < TimeSpan.FromSeconds(8));
    Assert.True(File.Exists(pidFile));
    var processId = await ReadProcessIdAsync(pidFile, TimeSpan.FromSeconds(3));
    Assert.True(await ProcessExitedAsync(processId, TimeSpan.FromSeconds(3)));
  }

  [Trait("Category", "ProcessTiming")]
  [Fact]
  public async Task CancellationTerminatesADescendantInTheOwnedJob()
  {
    var fixture = CreateFixture();
    var pidFile = Path.Combine(_directory, "descendant.pid");
    var escapedPidFile = pidFile.Replace("'", "''", StringComparison.Ordinal);
    var command =
      "$p = Start-Process -PassThru -FilePath $env:COMSPEC "
      + "-ArgumentList @('/d','/s','/c','ping -n 30 127.0.0.1 >nul'); "
      + $"[IO.File]::WriteAllText('{escapedPidFile}', [string]$p.Id); $p.WaitForExit()";
    var specification = fixture.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments(command),
      30,
      4_096);
    using var cancellation = new CancellationTokenSource();
    var running = fixture.Runner.RunAsync(
      specification,
      CommandContext(maxWallTimeSeconds: 30),
      cancellation.Token).AsTask();
    var deadline = DateTimeOffset.UtcNow.AddSeconds(5);
    while (!File.Exists(pidFile) && DateTimeOffset.UtcNow < deadline)
    {
      await Task.Delay(25);
    }
    Assert.True(File.Exists(pidFile));
    var processId = await ReadProcessIdAsync(pidFile, TimeSpan.FromSeconds(3));

    await cancellation.CancelAsync();
    await Assert.ThrowsAnyAsync<OperationCanceledException>(() => running);

    Assert.True(await ProcessExitedAsync(processId, TimeSpan.FromSeconds(3)));
  }

  [Fact]
  public async Task WrongPreStateNeverPreparesRecoveryOrStartsACommand()
  {
    var fixture = CreateFixture();
    using var arguments = JsonDocument.Parse(
      """{"executable":"cmd","argv":["/d","/s","/c","echo should-not-run"],"timeoutSeconds":5,"maximumOutputBytes":4096}""");
    var invalidContext = CommandContext() with
    {
      ExpectedPreStateSha256 = new string('0', 64),
    };

    await Assert.ThrowsAsync<HostPreconditionException>(() => fixture.Adapter.ExecuteAsync(
      invalidContext,
      arguments.RootElement,
      CancellationToken.None).AsTask());

    Assert.False(fixture.Recovery.PreparedIrreversible);
  }

  [Fact]
  public async Task RunnerRejectsAnUntypedExecutablePathBeforeIsolationOrLaunch()
  {
    var isolationGate = new RecordingRejectingIsolationGate();
    var fixture = CreateFixture(isolationGate: isolationGate);
    var allowed = fixture.Policy.Resolve(
      "cmd",
      ["/d", "/s", "/c", "echo must-not-launch"],
      5,
      4_096);
    var injected = allowed with
    {
      ExecutablePath = Path.Combine(Environment.SystemDirectory, "whoami.exe"),
    };

    var exception = await Assert.ThrowsAsync<HostPolicyException>(() =>
      fixture.Runner.RunAsync(
        injected,
        CommandContext(),
        CancellationToken.None).AsTask());

    Assert.Equal("command_resolved_specification_invalid", exception.ErrorCode);
    Assert.Empty(isolationGate.Bindings);
  }

  [Fact]
  public async Task EnabledConfigurationCannotBypassRejectingProductionIsolationGate()
  {
    var nativeLaunchAttempts = 0;
    var fixture = CreateFixture(
      isolationGate: new RejectingPrivilegedCommandTrustedRootIsolationGate(),
      nativeLaunchAttempt: () => Interlocked.Increment(ref nativeLaunchAttempts));
    var marker = Path.Combine(_directory, "must-not-launch.txt");
    var escapedMarker = marker.Replace("'", "''", StringComparison.Ordinal);
    var specification = fixture.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments($"[IO.File]::WriteAllText('{escapedMarker}', 'launched')"),
      5,
      4_096);

    var exception = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      fixture.Runner.RunAsync(
        specification,
        CommandContext(),
        CancellationToken.None).AsTask());

    Assert.Equal("trusted_root_isolation_unavailable", exception.ErrorCode);
    Assert.Equal(0, nativeLaunchAttempts);
    Assert.False(File.Exists(marker));
    Assert.All(
      typeof(PrivilegedOwnedCommandRunner).GetConstructors(),
      constructor => Assert.Contains(
        constructor.GetParameters(),
        parameter => parameter.ParameterType
          == typeof(IPrivilegedCommandTrustedRootIsolationGate)));
    var gateImplementations =
      typeof(IPrivilegedCommandTrustedRootIsolationGate).Assembly.GetTypes()
        .Where(type => !type.IsAbstract
          && !type.IsInterface
          && typeof(IPrivilegedCommandTrustedRootIsolationGate).IsAssignableFrom(type))
        .ToArray();
    var productionGate = Assert.Single(gateImplementations.Where(type =>
      type.GetConstructor(Type.EmptyTypes) is not null));
    Assert.Equal(typeof(RejectingPrivilegedCommandTrustedRootIsolationGate), productionGate);
    Assert.Empty(Assert.Single(productionGate.GetConstructors()).GetParameters());
    var optionalClient = Assert.Single(gateImplementations.Where(type =>
      type != productionGate));
    Assert.Equal(
      typeof(NamedPipePrivilegedCommandTrustedRootIsolationClient),
      optionalClient);
    Assert.Null(optionalClient.GetConstructor(Type.EmptyTypes));
  }

  [Fact]
  public async Task MismatchedIsolationAttestationCannotReachNativeLaunch()
  {
    var isolationGate = new RunnerPrivilegedCommandIsolationTestGate(
      new RunnerPrivilegedCommandIsolationTestBehavior(
        Tamper: RunnerPrivilegedCommandIsolationTamperMode.ReservationAction));
    var fixture = CreateFixture(isolationGate: isolationGate);
    var marker = Path.Combine(_directory, "invalid-attestation-must-not-launch.txt");
    var escapedMarker = marker.Replace("'", "''", StringComparison.Ordinal);
    var specification = fixture.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments($"[IO.File]::WriteAllText('{escapedMarker}', 'launched')"),
      5,
      4_096);

    var exception = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      fixture.Runner.RunAsync(
        specification,
        CommandContext(),
        CancellationToken.None).AsTask());

    Assert.Equal("trusted_root_isolation_reservation_invalid", exception.ErrorCode);
    Assert.False(File.Exists(marker));
  }

  [Fact]
  public async Task IsolationBindingIncludesEffectiveTaskResourceCeilings()
  {
    var isolationGate = new RecordingRejectingIsolationGate();
    var fixture = CreateFixture(isolationGate: isolationGate);
    var specification = fixture.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments("[Console]::Out.Write('must-not-launch')"),
      30,
      4_096);

    await Assert.ThrowsAsync<HostPreconditionException>(() => fixture.Runner.RunAsync(
      specification,
      CommandContext(maxWallTimeSeconds: 5, maxLocalBytes: 2_048),
      CancellationToken.None).AsTask());
    await Assert.ThrowsAsync<HostPreconditionException>(() => fixture.Runner.RunAsync(
      specification,
      CommandContext(maxWallTimeSeconds: 4, maxLocalBytes: 1_024),
      CancellationToken.None).AsTask());

    Assert.Equal(2, isolationGate.Bindings.Count);
    Assert.NotEqual(
      isolationGate.Bindings[0].InvocationSha256,
      isolationGate.Bindings[1].InvocationSha256);
  }

  [Fact]
  public async Task IsolationBindingIncludesDeploymentOwnedJobCeilings()
  {
    var firstGate = new RecordingRejectingIsolationGate();
    var first = CreateFixture(
      isolationGate: firstGate,
      maximumProcesses: 4,
      maximumProcessMemoryBytes: 134_217_728);
    var secondGate = new RecordingRejectingIsolationGate();
    var second = CreateFixture(
      isolationGate: secondGate,
      maximumProcesses: 5,
      maximumProcessMemoryBytes: 201_326_592);
    var firstSpecification = first.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments("[Console]::Out.Write('must-not-launch')"),
      5,
      4_096);
    var secondSpecification = second.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments("[Console]::Out.Write('must-not-launch')"),
      5,
      4_096);

    await Assert.ThrowsAsync<HostPreconditionException>(() => first.Runner.RunAsync(
      firstSpecification,
      CommandContext(),
      CancellationToken.None).AsTask());
    await Assert.ThrowsAsync<HostPreconditionException>(() => second.Runner.RunAsync(
      secondSpecification,
      CommandContext(),
      CancellationToken.None).AsTask());

    Assert.NotEqual(
      Assert.Single(firstGate.Bindings).InvocationSha256,
      Assert.Single(secondGate.Bindings).InvocationSha256);
  }

  [Fact]
  public void VerifiedLifecycleMarkersHaveNoPublicConstructors()
  {
    Type[] verifiedMarkers =
    [
      typeof(VerifiedPrivilegedCommandIsolationReservation),
      typeof(VerifiedPrivilegedCommandIsolationPreBindRelease),
      typeof(VerifiedPrivilegedCommandIsolationBindAcknowledgement),
      typeof(VerifiedPrivilegedCommandIsolationTerminalReceipt),
    ];

    Assert.All(
      verifiedMarkers,
      marker => Assert.Empty(marker.GetConstructors()));
  }

  [Trait("Category", "ProcessTiming")]
  [Fact]
  public async Task SignedIsolationLifecycleAndReplayCommitsPrecedeEachNativeTransition()
  {
    using var isolationGate = new RunnerPrivilegedCommandIsolationTestGate();
    var replayStore = new InMemoryPrivilegedCommandIsolationReplayStore();
    var launchAttempts = 0;
    var resumeAttempts = 0;
    var fixture = CreateFixture(
      isolationGate: isolationGate,
      replayStore: replayStore,
      nativeLaunchAttempt: () => Interlocked.Increment(ref launchAttempts),
      nativeResumeAttempt: () => Interlocked.Increment(ref resumeAttempts));
    var specification = fixture.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments("[Console]::Out.Write('lifecycle')"),
      5,
      4_096);

    var result = await fixture.Runner.RunAsync(
      specification,
      CommandContext(),
      CancellationToken.None);

    Assert.Equal(0, result.ExitCode);
    Assert.Equal(1, launchAttempts);
    Assert.Equal(1, resumeAttempts);
    Assert.Equal(["reserve", "bind", "terminal", "dispose"], isolationGate.Calls);
    Assert.Equal(["reservation", "bind", "terminal"], replayStore.Calls);
    var process = Assert.Single(isolationGate.ProcessObservations);
    Assert.True(process.CreatedSuspended);
    Assert.True(process.AssignedToJob);
    var terminal = Assert.Single(isolationGate.TerminalObservations);
    Assert.True(terminal.ProcessResumed);
    Assert.True(terminal.ExitCodeKnown);
    Assert.Equal(0, terminal.ExitCode);
    Assert.Equal(PrivilegedCommandIsolationTerminalOutcomes.Completed, terminal.Outcome);
  }

  [Trait("Category", "ProcessTiming")]
  [Fact]
  public async Task BlockingBindCannotResumeOrExecuteTheSuspendedChild()
  {
    using var isolationGate = new RunnerPrivilegedCommandIsolationTestGate(
      new RunnerPrivilegedCommandIsolationTestBehavior(
        BlockAt: RunnerPrivilegedCommandIsolationStage.Bind));
    var resumeAttempts = 0;
    var fixture = CreateFixture(
      isolationGate: isolationGate,
      nativeResumeAttempt: () => Interlocked.Increment(ref resumeAttempts));
    var marker = Path.Combine(_directory, "bind-before-resume.txt");
    var escapedMarker = marker.Replace("'", "''", StringComparison.Ordinal);
    var specification = fixture.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments($"[IO.File]::WriteAllText('{escapedMarker}', 'resumed')"),
      10,
      4_096);
    using var waitTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    var running = fixture.Runner.RunAsync(
      specification,
      CommandContext(maxWallTimeSeconds: 10),
      CancellationToken.None).AsTask();

    await isolationGate.WaitUntilBlockedAsync(waitTimeout.Token);
    try
    {
      Assert.Equal(0, resumeAttempts);
      Assert.False(File.Exists(marker));
    }
    finally
    {
      isolationGate.Unblock();
    }

    _ = await running;
    Assert.Equal(1, resumeAttempts);
    Assert.True(File.Exists(marker));
  }

  [Fact]
  public async Task MissingBindKillsTheSuspendedChildAndCommitsPreBindRelease()
  {
    using var isolationGate = new RunnerPrivilegedCommandIsolationTestGate(
      new RunnerPrivilegedCommandIsolationTestBehavior(
        ReturnNullAt: RunnerPrivilegedCommandIsolationStage.Bind));
    var replayStore = new InMemoryPrivilegedCommandIsolationReplayStore();
    var resumeAttempts = 0;
    var fixture = CreateFixture(
      isolationGate: isolationGate,
      replayStore: replayStore,
      nativeResumeAttempt: () => Interlocked.Increment(ref resumeAttempts));
    var marker = Path.Combine(_directory, "invalid-bind-must-not-run.txt");
    var escapedMarker = marker.Replace("'", "''", StringComparison.Ordinal);
    var specification = fixture.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments($"[IO.File]::WriteAllText('{escapedMarker}', 'resumed')"),
      5,
      4_096);

    var exception = await Assert.ThrowsAsync<HostPreconditionException>(() =>
      fixture.Runner.RunAsync(
        specification,
        CommandContext(),
        CancellationToken.None).AsTask());

    Assert.Equal("trusted_root_isolation_bind_invalid", exception.ErrorCode);
    Assert.Equal(0, resumeAttempts);
    Assert.False(File.Exists(marker));
    Assert.Equal(
      ["reserve", "bind", "pre-bind-release", "dispose"],
      isolationGate.Calls);
    Assert.Equal(["reservation", "pre-bind-release"], replayStore.Calls);
  }

  [Fact]
  public async Task CancellationAfterVerifiedBindSettlesAsNeverResumed()
  {
    using var isolationGate = new RunnerPrivilegedCommandIsolationTestGate();
    var replayStore = new InMemoryPrivilegedCommandIsolationReplayStore();
    using var cancellation = new CancellationTokenSource();
    var fixture = CreateFixture(
      isolationGate: isolationGate,
      replayStore: replayStore,
      nativeResumeAttempt: () =>
      {
        cancellation.Cancel();
        cancellation.Token.ThrowIfCancellationRequested();
      });
    var marker = Path.Combine(_directory, "cancelled-before-resume.txt");
    var escapedMarker = marker.Replace("'", "''", StringComparison.Ordinal);
    var specification = fixture.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments($"[IO.File]::WriteAllText('{escapedMarker}', 'resumed')"),
      5,
      4_096);

    await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
      fixture.Runner.RunAsync(
        specification,
        CommandContext(),
        cancellation.Token).AsTask());

    Assert.False(File.Exists(marker));
    var terminal = Assert.Single(isolationGate.TerminalObservations);
    Assert.False(terminal.ProcessResumed);
    Assert.Equal(PrivilegedCommandIsolationTerminalOutcomes.Cancelled, terminal.Outcome);
    Assert.Equal(["reservation", "bind", "terminal"], replayStore.Calls);
  }

  [Trait("Category", "ProcessTiming")]
  [Fact]
  public async Task MissingTerminalReceiptTripsLatchAndIsNotRetriedAfterTheCommandRan()
  {
    using var isolationGate = new RunnerPrivilegedCommandIsolationTestGate(
      new RunnerPrivilegedCommandIsolationTestBehavior(
        ReturnNullAt: RunnerPrivilegedCommandIsolationStage.Terminal));
    var latch = new PrivilegedCommandIsolationDispatchLatch();
    var fixture = CreateFixture(
      isolationGate: isolationGate,
      isolationDispatchLatch: latch);
    var marker = Path.Combine(_directory, "terminal-receipt-missing.txt");
    var escapedMarker = marker.Replace("'", "''", StringComparison.Ordinal);
    var specification = fixture.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments($"[IO.File]::WriteAllText('{escapedMarker}', 'executed')"),
      5,
      4_096);

    var exception = await Assert.ThrowsAsync<PrivilegedCommandIsolationUnsafeException>(() =>
      fixture.Runner.RunAsync(
        specification,
        CommandContext(),
        CancellationToken.None).AsTask());

    Assert.Equal("trusted_root_isolation_terminal_receipt_invalid", exception.ErrorCode);
    Assert.Equal("terminal-settlement", exception.Phase);
    Assert.True(exception.MayHaveExecuted);
    Assert.True(latch.IsTripped);
    Assert.True(File.Exists(marker));
    Assert.Equal(1, isolationGate.TerminalCallCount);
    Assert.Equal(["reserve", "bind", "terminal", "dispose"], isolationGate.Calls);
  }

  [Fact]
  public async Task PreBindReleaseOutcomeMustMatchRequestedBranchAndStopsLaterDispatch()
  {
    using var isolationGate = new RunnerPrivilegedCommandIsolationTestGate(
      new RunnerPrivilegedCommandIsolationTestBehavior(
        ReturnNullAt: RunnerPrivilegedCommandIsolationStage.Bind,
        Tamper: RunnerPrivilegedCommandIsolationTamperMode.PreBindReleaseOutcome));
    var replayStore = new InMemoryPrivilegedCommandIsolationReplayStore();
    var latch = new PrivilegedCommandIsolationDispatchLatch();
    var fixture = CreateFixture(
      isolationGate: isolationGate,
      replayStore: replayStore,
      isolationDispatchLatch: latch);
    var specification = fixture.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments("[Console]::Out.Write('must-not-run')"),
      5,
      4_096);

    var failure = await Assert.ThrowsAsync<PrivilegedCommandIsolationUnsafeException>(() =>
      fixture.Runner.RunAsync(
        specification,
        CommandContext(),
        CancellationToken.None).AsTask());

    Assert.Equal("trusted_root_isolation_pre_bind_release_invalid", failure.ErrorCode);
    Assert.False(failure.MayHaveExecuted);
    Assert.True(latch.IsTripped);
    Assert.Equal(["reservation"], replayStore.Calls);
    Assert.Equal(1, isolationGate.ReserveCallCount);

    var fenced = await Assert.ThrowsAsync<PrivilegedCommandIsolationUnsafeException>(() =>
      fixture.Runner.RunAsync(
        specification,
        CommandContext(),
        CancellationToken.None).AsTask());
    Assert.Equal("trusted_root_isolation_reconciliation_required", fenced.ErrorCode);
    Assert.False(fenced.MayHaveExecuted);
    Assert.Equal(1, isolationGate.ReserveCallCount);
  }

  [Trait("Category", "ProcessTiming")]
  [Fact]
  public async Task IsolationViolationReceiptCommitsBeforePermanentlyFencingDispatch()
  {
    using var isolationGate = new RunnerPrivilegedCommandIsolationTestGate(
      new RunnerPrivilegedCommandIsolationTestBehavior(
        Tamper: RunnerPrivilegedCommandIsolationTamperMode.TerminalIsolationViolation));
    var replayStore = new InMemoryPrivilegedCommandIsolationReplayStore();
    var latch = new PrivilegedCommandIsolationDispatchLatch();
    var fixture = CreateFixture(
      isolationGate: isolationGate,
      replayStore: replayStore,
      isolationDispatchLatch: latch);
    var marker = Path.Combine(_directory, "terminal-isolation-violation.txt");
    var escapedMarker = marker.Replace("'", "''", StringComparison.Ordinal);
    var specification = fixture.Policy.Resolve(
      "windows-powershell",
      PowerShellArguments($"[IO.File]::WriteAllText('{escapedMarker}', 'executed')"),
      5,
      4_096);

    var failure = await Assert.ThrowsAsync<PrivilegedCommandIsolationUnsafeException>(() =>
      fixture.Runner.RunAsync(
        specification,
        CommandContext(),
        CancellationToken.None).AsTask());

    Assert.Equal("trusted_root_isolation_enforcement_not_continuous", failure.ErrorCode);
    Assert.True(failure.MayHaveExecuted);
    Assert.True(latch.IsTripped);
    Assert.True(File.Exists(marker));
    Assert.Equal(["reservation", "bind", "terminal"], replayStore.Calls);

    var fenced = await Assert.ThrowsAsync<PrivilegedCommandIsolationUnsafeException>(() =>
      fixture.Runner.RunAsync(
        specification,
        CommandContext(),
        CancellationToken.None).AsTask());
    Assert.Equal("trusted_root_isolation_reconciliation_required", fenced.ErrorCode);
    Assert.Equal(1, isolationGate.ReserveCallCount);
  }

  public void Dispose()
  {
    if (Directory.Exists(_directory))
    {
      Directory.Delete(_directory, recursive: true);
    }
  }

  private static CommandFixture CreateFixture(
    long maximumOutputBytes = 1_048_576,
    IPrivilegedCommandTrustedRootIsolationGate? isolationGate = null,
    IPrivilegedCommandIsolationReplayStore? replayStore = null,
    PrivilegedCommandIsolationDispatchLatch? isolationDispatchLatch = null,
    Action? nativeLaunchAttempt = null,
    Action? nativeResumeAttempt = null,
    int maximumProcesses = 8,
    long maximumProcessMemoryBytes = 268_435_456)
  {
    var commandOptions = Options.Create(new PrivilegedCommandOptions
    {
      Enabled = true,
      MaximumTimeoutSeconds = 60,
      MaximumOutputBytes = maximumOutputBytes,
      MaximumProcesses = maximumProcesses,
      MaximumProcessMemoryBytes = maximumProcessMemoryBytes,
    });
    var hostOptions = Options.Create(new HostCapabilityOptions());
    var companionOptions = Options.Create(new CompanionOptions());
    var brokerOptions = Options.Create(new BrokerChannelOptions());
    var policy = new PrivilegedCommandPolicy(
      commandOptions,
      hostOptions,
      companionOptions,
      brokerOptions);
    var runner = new PrivilegedOwnedCommandRunner(
      commandOptions,
      policy,
      isolationGate ?? new RunnerPrivilegedCommandIsolationTestGate(),
      replayStore ?? new InMemoryPrivilegedCommandIsolationReplayStore(),
      isolationDispatchLatch ?? new PrivilegedCommandIsolationDispatchLatch(),
      nativeLaunchAttempt ?? (static () => { }),
      nativeResumeAttempt);
    var recovery = new RecordingRecoveryVault();
    return new CommandFixture(
      policy,
      runner,
      recovery,
      new PrivilegedCommandExecuteCapabilityAdapter(policy, runner, recovery));
  }


  [Fact]
  public async Task ReservationCommitFailureSurvivesAFailingPreBindRelease()
  {
    // The real shape of the bug, and deliberately not a timing test: when the
    // reservation never reached the ledger, the pre-bind release that cleans up
    // after it CANNOT succeed either - there is nothing recorded to release. So
    // the cleanup always threw, and because it rethrows rather than swallowing,
    // its exception replaced the one that explained the failure. An operator
    // asking why a workstation fenced itself was told the release was invalid,
    // which is a consequence, not a cause.
    var replayStore = new InMemoryPrivilegedCommandIsolationReplayStore { IsAvailable = false };
    var latch = new PrivilegedCommandIsolationDispatchLatch();
    var fixture = CreateFixture(replayStore: replayStore, isolationDispatchLatch: latch);
    var specification = fixture.Policy.Resolve(
      "cmd",
      ["/d", "/s", "/c", "echo hello"],
      5,
      4_096);

    var failure = await Assert.ThrowsAsync<PrivilegedCommandIsolationUnsafeException>(
      () => fixture.Runner.RunAsync(
        specification,
        CommandContext(),
        CancellationToken.None).AsTask());

    Assert.Equal("trusted_root_isolation_reservation_replay_invalid", failure.ErrorCode);
    Assert.Equal("reservation-commit", failure.Phase);
    Assert.False(failure.MayHaveExecuted);

    // The release's own failure is carried rather than discarded: losing it
    // would trade one blind spot for another.
    var carried = Assert.IsType<string>(failure.Data["PreBindReleaseFailure"]);
    Assert.Contains(
      "trusted_root_isolation_pre_bind_release_replay_invalid",
      carried,
      StringComparison.Ordinal);

    // Safety is unchanged by which exception surfaces: the release path trips
    // the latch on its way out, so dispatch stays fenced either way.
    Assert.True(latch.IsTripped);
  }
  private static ActionExecutionContext CommandContext(
    long maxWallTimeSeconds = 60,
    long maxLocalBytes = 1_048_576)
  {
    const string actionId = "11111111-1111-4111-8111-111111111111";
    const string taskId = "22222222-2222-4222-8222-222222222222";
    const string planVersionId = "33333333-3333-4333-8333-333333333333";
    const string stepId = "44444444-4444-4444-8444-444444444444";
    const string deviceId = "55555555-5555-4555-8555-555555555555";
    const string mandateId = "66666666-6666-4666-8666-666666666666";
    const string idempotencyKey = "idempotency-command";
    const string leaseId = "privileged-command-test-lease";
    const string fencingToken = "1";
    const string compactToken = "runner.test.compact-token";
    const string argumentsJson = "{\"test\":\"privileged-command\"}";
    var argumentsSha256 = PayloadDigest.Sha256Hex(argumentsJson);
    var budgets = new ActionBudget(
      maxWallTimeSeconds,
      10,
      10,
      1,
      maxLocalBytes,
      1_048_576,
      1);
    var now = DateTimeOffset.UtcNow;
    var leaseExpiresAt = now.AddMinutes(10);
    var request = new ActionRequest(
      actionId,
      taskId,
      planVersionId,
      stepId,
      deviceId,
      mandateId,
      PrivilegedCommandIsolationCapability.Id,
      PrivilegedCommandIsolationCapability.Version,
      argumentsJson,
      argumentsSha256,
      PrivilegedCommandExecuteCapabilityAdapter.UnboundedHostPreStateSha256,
      InputProvenanceSha256: null,
      IdempotencyKey: idempotencyKey,
      DispatchCount: 1,
      LeaseId: leaseId,
      FencingToken: fencingToken,
      LeaseExpiresAt: leaseExpiresAt,
      ExecutionMode: ActionExecutionModes.Execute);
    var claims = new ActionTokenClaims
    {
      Issuer = "itemba-msaidizi-broker",
      Audience = "itemba-windows-companion",
      Subject = "msaidizi-global",
      TokenId = "privileged-command-test-token",
      ActionId = actionId,
      TaskId = taskId,
      PlanVersionId = planVersionId,
      StepId = stepId,
      DeviceId = deviceId,
      MandateId = mandateId,
      CapabilityId = request.CapabilityId,
      CapabilityVersion = request.CapabilityVersion,
      ArgumentsSha256 = argumentsSha256,
      ExpectedPreStateSha256 = request.ExpectedPreStateSha256,
      InputProvenanceSha256 = null,
      IdempotencyKey = idempotencyKey,
      LeaseId = leaseId,
      FencingToken = fencingToken,
      LeaseExpiresAtUnixSeconds = leaseExpiresAt.ToUnixTimeSeconds(),
      DispatchCount = 1,
      ExecutionMode = ActionExecutionModes.Execute,
      Budgets = budgets,
      IssuedAtUnixSeconds = now.ToUnixTimeSeconds(),
      ExpiresAtUnixSeconds = now.AddMinutes(5).ToUnixTimeSeconds(),
    };
    return new ActionExecutionContext(
      actionId,
      taskId,
      planVersionId,
      stepId,
      deviceId,
      mandateId,
      idempotencyKey,
      request.ExpectedPreStateSha256,
      InputProvenanceSha256: null,
      Budgets: budgets,
      ActionTokenSha256: PayloadDigest.Sha256Hex(compactToken),
      EphemeralAuthorization: new EphemeralActionAuthorization(
        new SignedActionRequest(request, compactToken),
        claims));
  }

  private static string[] PowerShellArguments(string command) =>
  [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "AllSigned",
    "-Command",
    command,
  ];

  private static async Task<bool> ProcessExitedAsync(int processId, TimeSpan timeout)
  {
    try
    {
      using var process = Process.GetProcessById(processId);
      using var cancellation = new CancellationTokenSource(timeout);
      await process.WaitForExitAsync(cancellation.Token);
      return true;
    }
    catch (ArgumentException)
    {
      return true;
    }
    catch (OperationCanceledException)
    {
      return false;
    }
  }

  private static async Task<int> ReadProcessIdAsync(string path, TimeSpan timeout)
  {
    var deadline = DateTimeOffset.UtcNow.Add(timeout);
    while (DateTimeOffset.UtcNow < deadline)
    {
      try
      {
        var text = await File.ReadAllTextAsync(path);
        if (int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture,
            out var processId) && processId > 0)
        {
          return processId;
        }
      }
      catch (IOException)
      {
        // The child can briefly retain its exclusive create handle after the
        // directory entry becomes visible. Retry until the bounded deadline.
      }
      await Task.Delay(25);
    }
    throw new TimeoutException("The descendant process ID was not readable in time.");
  }

  private sealed record CommandFixture(
    PrivilegedCommandPolicy Policy,
    PrivilegedOwnedCommandRunner Runner,
    RecordingRecoveryVault Recovery,
    PrivilegedCommandExecuteCapabilityAdapter Adapter);

  private sealed class RecordingRecoveryVault : IHostRecoveryVault
  {
    public bool PreparedIrreversible { get; private set; }

    public ValueTask<HostRecoveryReceipt> PrepareAsync(
      ActionExecutionContext context,
      string operation,
      string preStateSha256,
      object recoveryRecord,
      bool irreversible,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Assert.Equal(PrivilegedCommandExecuteCapabilityAdapter.CapabilityId, operation);
      Assert.Equal(
        PrivilegedCommandExecuteCapabilityAdapter.UnboundedHostPreStateSha256,
        preStateSha256);
      PreparedIrreversible = irreversible;
      return ValueTask.FromResult(new HostRecoveryReceipt(
        "opaque-recovery",
        new string('a', 64),
        "protected-path-never-returned"));
    }
  }

  private sealed class RecordingRejectingIsolationGate :
    IPrivilegedCommandTrustedRootIsolationGate
  {
    public List<PrivilegedCommandIsolationRequestBinding> Bindings { get; } = [];

    public ValueTask<IPrivilegedCommandTrustedRootIsolationSession?> TryReserveAsync(
      PrivilegedCommandIsolationRequestBinding binding,
      CancellationToken cancellationToken)
    {
      cancellationToken.ThrowIfCancellationRequested();
      Bindings.Add(binding);
      return ValueTask.FromResult<IPrivilegedCommandTrustedRootIsolationSession?>(null);
    }
  }
}
