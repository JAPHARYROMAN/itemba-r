using System.Buffers;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

public sealed record PrivilegedCommandSpec(
  string ExecutableId,
  string ExecutablePath,
  IReadOnlyList<string> Arguments,
  string WorkingDirectory,
  IReadOnlyDictionary<string, string> Environment,
  int TimeoutSeconds,
  long MaximumOutputBytes);

public sealed record PrivilegedCommandResult(
  int ExitCode,
  long StandardOutputBytes,
  long StandardErrorBytes,
  string StandardOutputSha256,
  string StandardErrorSha256,
  string ExecutableSha256,
  string IsolationPolicySha256,
  string IsolationAttestationSha256);

/// <summary>
/// Exact LocalSystem command policy. Action input selects only one of two
/// fixed System32 images and supplies an argv vector; it cannot supply an
/// executable path, working directory, environment variable, or inherited
/// handle. Direct references to supervisor-owned storage and common path
/// discovery/encoding forms fail closed before native launch.
/// </summary>
public sealed class PrivilegedCommandPolicy
{
  private static readonly string[] ForbiddenArgumentMarkers =
  [
    @"\\?\",
    @"\\.\",
    @"\??\",
    "globalroot",
    "-encodedcommand",
    "-encodedarguments",
    "frombase64string",
    "getenvironmentvariable",
    "specialfolder",
    "$env:programdata",
    "${env:programdata}",
    "%programdata%",
    "$env:commonappdata",
    "commonapplicationdata",
  ];

  private readonly PrivilegedCommandOptions _options;
  private readonly Dictionary<string, string> _executables;
  private readonly string[] _protectedPathMarkers;
  private readonly string _workingDirectory;
  private readonly IReadOnlyDictionary<string, string> _environment;

  public PrivilegedCommandPolicy(
    IOptions<PrivilegedCommandOptions> options,
    IOptions<HostCapabilityOptions> hostOptions,
    IOptions<CompanionOptions> companionOptions,
    IOptions<BrokerChannelOptions> brokerOptions)
  {
    _options = options.Value;
    if (!_options.Enabled
      || _options.MaximumTimeoutSeconds is < 1 or > 900
      || _options.MaximumOutputBytes is < 1 or > 16_777_216
      || _options.MaximumProcesses is < 1 or > 32
      || _options.MaximumProcessMemoryBytes is < 67_108_864 or > 2_147_483_648)
    {
      throw new InvalidOperationException(
        "The privileged-command deployment gate and hard ceilings are invalid.");
    }

    var windows = Path.TrimEndingDirectorySeparator(Path.GetFullPath(
      Environment.GetFolderPath(Environment.SpecialFolder.Windows)));
    var system32 = Path.TrimEndingDirectorySeparator(Path.GetFullPath(
      Environment.SystemDirectory));
    if (!Directory.Exists(system32)
      || !SupervisorPathPolicy.IsEqualOrDescendant(system32, windows))
    {
      throw new InvalidOperationException(
        "The privileged-command System32 working directory is unavailable.");
    }

    _workingDirectory = system32;
    _executables = new Dictionary<string, string>(StringComparer.Ordinal)
    {
      ["cmd"] = Path.Combine(system32, "cmd.exe"),
      ["windows-powershell"] = Path.Combine(
        system32,
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe"),
    };
    if (_executables.Values.Any(path => !File.Exists(path)))
    {
      throw new InvalidOperationException(
        "A fixed privileged-command System32 executable is unavailable.");
    }

    var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
    var protectedPaths = SupervisorPathPolicy.BuildProtectedPaths(
      hostOptions.Value,
      companionOptions.Value,
      brokerOptions.Value);
    if (!string.IsNullOrWhiteSpace(programData))
    {
      protectedPaths.Add(Path.Combine(programData, "Itemba", "Msaidizi"));
    }
    _protectedPathMarkers = protectedPaths
      .SelectMany(ProtectedPathMarkers)
      .Distinct(StringComparer.OrdinalIgnoreCase)
      .OrderByDescending(value => value.Length)
      .ToArray();
    _environment = BuildEnvironment(windows, system32);
  }

  public PrivilegedCommandSpec Resolve(
    string executableId,
    IReadOnlyList<string> arguments,
    int timeoutSeconds,
    long maximumOutputBytes)
  {
    if (!_executables.TryGetValue(executableId, out var executablePath))
    {
      throw new HostPolicyException("command_executable_not_allowed");
    }
    if (timeoutSeconds is < 1 || timeoutSeconds > _options.MaximumTimeoutSeconds)
    {
      throw new HostPolicyException("command_timeout_not_allowed");
    }
    if (maximumOutputBytes is < 1 || maximumOutputBytes > _options.MaximumOutputBytes)
    {
      throw new HostPolicyException("command_output_limit_not_allowed");
    }

    ValidateArguments(executableId, arguments);
    return new PrivilegedCommandSpec(
      executableId,
      executablePath,
      arguments.ToArray(),
      _workingDirectory,
      _environment,
      timeoutSeconds,
      maximumOutputBytes);
  }

  public void ValidateArguments(string executableId, IReadOnlyList<string> arguments)
  {
    if (arguments.Count is < 1 or > 64
      || arguments.Any(argument => argument is null
        || argument.Length > 4_096
        || argument.Any(char.IsControl)))
    {
      throw new HostPolicyException("command_arguments_not_allowed");
    }

    if (string.Equals(executableId, "cmd", StringComparison.Ordinal))
    {
      if (arguments.Count < 4
        || !string.Equals(arguments[0], "/d", StringComparison.OrdinalIgnoreCase)
        || !string.Equals(arguments[1], "/s", StringComparison.OrdinalIgnoreCase)
        || !string.Equals(arguments[2], "/c", StringComparison.OrdinalIgnoreCase))
      {
        throw new HostPolicyException("command_cmd_prefix_required");
      }
    }
    else if (string.Equals(executableId, "windows-powershell", StringComparison.Ordinal))
    {
      string[] required =
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "AllSigned",
        "-Command",
      ];
      if (arguments.Count <= required.Length
        || !arguments.Take(required.Length).SequenceEqual(
          required,
          StringComparer.OrdinalIgnoreCase))
      {
        throw new HostPolicyException("command_powershell_prefix_required");
      }
    }
    else
    {
      throw new HostPolicyException("command_executable_not_allowed");
    }

    foreach (var argument in arguments)
    {
      var inspected = NormalizeForInspection(argument);
      if (ForbiddenArgumentMarkers.Any(marker =>
          inspected.Contains(marker, StringComparison.OrdinalIgnoreCase))
        || _protectedPathMarkers.Any(marker =>
          inspected.Contains(marker, StringComparison.OrdinalIgnoreCase))
        || (inspected.Contains("itemba", StringComparison.OrdinalIgnoreCase)
          && inspected.Contains("msaidizi", StringComparison.OrdinalIgnoreCase)))
      {
        throw new HostPolicyException("command_trusted_root_reference_forbidden");
      }
    }

    if (PrivilegedOwnedCommandRunner.BuildCommandLine(
        _executables[executableId],
        arguments).Length >= 32_767)
    {
      throw new HostPolicyException("command_line_limit_exceeded");
    }
  }

  private static Dictionary<string, string> BuildEnvironment(
    string windows,
    string system32)
  {
    var powershell = Path.Combine(system32, "WindowsPowerShell", "v1.0");
    var systemDrive = Path.GetPathRoot(windows)
      ?? throw new InvalidOperationException("The Windows directory has no local volume.");
    return new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
      ["COMSPEC"] = Path.Combine(system32, "cmd.exe"),
      ["OS"] = "Windows_NT",
      ["PATH"] = string.Join(Path.PathSeparator, system32, windows, powershell),
      ["PATHEXT"] = ".COM;.EXE;.BAT;.CMD",
      ["POWERSHELL_TELEMETRY_OPTOUT"] = "1",
      ["PSModulePath"] = Path.Combine(
        system32,
        "WindowsPowerShell",
        "v1.0",
        "Modules"),
      ["SystemDrive"] = Path.TrimEndingDirectorySeparator(systemDrive),
      ["SystemRoot"] = windows,
      ["WINDIR"] = windows,
    };
  }

  private static IEnumerable<string> ProtectedPathMarkers(string path)
  {
    var normalized = Path.TrimEndingDirectorySeparator(Path.GetFullPath(path))
      .Replace('/', '\\');
    yield return normalized;
    yield return normalized.Replace("\\", "/", StringComparison.Ordinal);
    var root = Path.GetPathRoot(normalized);
    if (!string.IsNullOrEmpty(root) && normalized.Length > root.Length)
    {
      var relative = normalized[root.Length..].TrimStart('\\');
      yield return relative;
      yield return relative.Replace("\\", "/", StringComparison.Ordinal);
    }
  }

  private static string NormalizeForInspection(string argument) => argument
    .Replace('/', '\\')
    .Replace("\"", string.Empty, StringComparison.Ordinal)
    .Replace("'", string.Empty, StringComparison.Ordinal)
    .Replace("`", string.Empty, StringComparison.Ordinal)
    .Replace("^", string.Empty, StringComparison.Ordinal);
}

/// <summary>
/// Native, LocalSystem process boundary. The selected System32 image is opened
/// without write/delete sharing, launched suspended, assigned to a
/// kill-on-close Job Object with process/memory/CPU ceilings, and only then
/// resumed. stdout/stderr are streamed into bounded digests and never retained
/// as command text.
/// </summary>
public sealed partial class PrivilegedOwnedCommandRunner
{
  private const uint CreateSuspended = 0x00000004;
  private const uint CreateNoWindow = 0x08000000;
  private const uint CreateUnicodeEnvironment = 0x00000400;
  private const uint ExtendedStartupInfoPresent = 0x00080000;
  private const uint StartfUseStdHandles = 0x00000100;
  private const uint HandleFlagInherit = 0x00000001;
  private const nuint ProcThreadAttributeHandleList = 0x00020002;
  private const nuint ProcThreadAttributeJobList = 0x0002000D;
  private const uint JobObjectLimitJobTime = 0x00000004;
  private const uint JobObjectLimitActiveProcess = 0x00000008;
  private const uint JobObjectLimitProcessMemory = 0x00000100;
  private const uint JobObjectLimitKillOnJobClose = 0x00002000;
  private const int JobObjectExtendedLimitInformationClass = 9;
  private const uint StillActive = 259;
  private readonly PrivilegedCommandOptions _options;
  private readonly PrivilegedCommandPolicy _policy;
  private readonly IPrivilegedCommandTrustedRootIsolationGate _trustedRootIsolation;
  private readonly IPrivilegedCommandIsolationReplayStore _isolationReplayStore;
  private readonly PrivilegedCommandIsolationDispatchLatch _isolationDispatchLatch;
  private readonly Action _nativeLaunchAttempt;
  private readonly Action _nativeResumeAttempt;

  public PrivilegedOwnedCommandRunner(
    IOptions<PrivilegedCommandOptions> options,
    PrivilegedCommandPolicy policy,
    IPrivilegedCommandTrustedRootIsolationGate trustedRootIsolation,
    IPrivilegedCommandIsolationReplayStore isolationReplayStore,
    PrivilegedCommandIsolationDispatchLatch isolationDispatchLatch)
    : this(
      options,
      policy,
      trustedRootIsolation,
      isolationReplayStore,
      isolationDispatchLatch,
      static () => { },
      static () => { })
  {
  }

  internal PrivilegedOwnedCommandRunner(
    IOptions<PrivilegedCommandOptions> options,
    PrivilegedCommandPolicy policy,
    IPrivilegedCommandTrustedRootIsolationGate trustedRootIsolation,
    IPrivilegedCommandIsolationReplayStore isolationReplayStore,
    PrivilegedCommandIsolationDispatchLatch isolationDispatchLatch,
    Action nativeLaunchAttempt,
    Action? nativeResumeAttempt = null)
  {
    _options = options.Value;
    _policy = policy;
    _trustedRootIsolation = trustedRootIsolation;
    _isolationReplayStore = isolationReplayStore;
    _isolationDispatchLatch = isolationDispatchLatch;
    _nativeLaunchAttempt = nativeLaunchAttempt;
    _nativeResumeAttempt = nativeResumeAttempt ?? (static () => { });
  }

  public async ValueTask<PrivilegedCommandResult> RunAsync(
    PrivilegedCommandSpec specification,
    ActionExecutionContext context,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    _isolationDispatchLatch.ThrowIfTripped();
    EnsureSpecificationMatchesPolicy(specification);
    var outputLimit = Math.Min(
      specification.MaximumOutputBytes,
      Math.Min(_options.MaximumOutputBytes, context.Budgets.MaxLocalBytes));
    if (outputLimit <= 0)
    {
      throw new HostPolicyException("command_output_budget_required");
    }

    var timeoutSeconds = checked((int)Math.Min(
      specification.TimeoutSeconds,
      Math.Min(_options.MaximumTimeoutSeconds, context.Budgets.MaxWallTimeSeconds)));
    if (timeoutSeconds <= 0)
    {
      throw new HostPolicyException("command_timeout_budget_required");
    }

    using var timeoutCancellation = new CancellationTokenSource(
      TimeSpan.FromSeconds(timeoutSeconds));
    using var executionCancellation = CancellationTokenSource.CreateLinkedTokenSource(
      cancellationToken,
      timeoutCancellation.Token);
    try
    {
      return await RunOwnedAsync(
        specification,
        context,
        outputLimit,
        timeoutSeconds,
        cancellationToken,
        timeoutCancellation.Token,
        executionCancellation.Token).ConfigureAwait(false);
    }
    catch (OperationCanceledException exception) when (
      timeoutCancellation.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
    {
      throw new TimeoutException("command_timeout_exceeded", exception);
    }
  }

  private void EnsureSpecificationMatchesPolicy(PrivilegedCommandSpec specification)
  {
    var expected = _policy.Resolve(
      specification.ExecutableId,
      specification.Arguments,
      specification.TimeoutSeconds,
      specification.MaximumOutputBytes);
    if (!string.Equals(
        specification.ExecutablePath,
        expected.ExecutablePath,
        StringComparison.OrdinalIgnoreCase)
      || !string.Equals(
        specification.WorkingDirectory,
        expected.WorkingDirectory,
        StringComparison.OrdinalIgnoreCase)
      || specification.Environment.Count != expected.Environment.Count
      || expected.Environment.Any(pair =>
        !specification.Environment.TryGetValue(pair.Key, out var value)
          || !string.Equals(value, pair.Value, StringComparison.Ordinal)))
    {
      throw new HostPolicyException("command_resolved_specification_invalid");
    }
  }

  internal static string BuildCommandLine(
    string executablePath,
    IReadOnlyList<string> arguments) => string.Join(
    ' ',
    new[] { executablePath }.Concat(arguments).Select(QuoteArgument));

  internal static string QuoteArgument(string argument)
  {
    if (argument.Length > 0
      && !argument.Any(character => char.IsWhiteSpace(character) || character == '"'))
    {
      return argument;
    }

    var output = new StringBuilder(argument.Length + 2).Append('"');
    var slashes = 0;
    foreach (var character in argument)
    {
      if (character == '\\')
      {
        slashes++;
        continue;
      }
      if (character == '"')
      {
        output.Append('\\', checked(slashes * 2 + 1));
        output.Append('"');
        slashes = 0;
        continue;
      }

      output.Append('\\', slashes);
      output.Append(character);
      slashes = 0;
    }

    output.Append('\\', checked(slashes * 2));
    return output.Append('"').ToString();
  }

  private async ValueTask<PrivilegedCommandResult> RunOwnedAsync(
    PrivilegedCommandSpec specification,
    ActionExecutionContext context,
    long outputLimit,
    int timeoutSeconds,
    CancellationToken callerCancellationToken,
    CancellationToken timeoutCancellationToken,
    CancellationToken cancellationToken)
  {
    using var executableLock = SupervisorPathPolicy.OpenSystemExecutablePath(
      specification.ExecutablePath);
    SupervisorPathPolicy.EnsureHandleStillNames(
      executableLock,
      specification.ExecutablePath);
    string executableSha256;
    using (var executable = new FileStream(
      specification.ExecutablePath,
      FileMode.Open,
      FileAccess.Read,
      FileShare.Read))
    {
      executableSha256 = Convert.ToHexString(SHA256.HashData(executable)).ToLowerInvariant();
    }

    using var job = new SafeJobHandle(CreateJobObject(IntPtr.Zero, null));
    if (job.IsInvalid)
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    ConfigureJob(job, timeoutSeconds);
    using var stdout = AnonymousPipe.Create();
    using var stderr = AnonymousPipe.Create();
    using var standardInput = OpenNullInput();
    using var attributes = ProcessAttributeList.Create(
      job,
      standardInput,
      stdout.Write,
      stderr.Write);
    var commandLine = BuildCommandLine(
      specification.ExecutablePath,
      specification.Arguments);
    if (commandLine.Length >= 32_767)
    {
      throw new HostPolicyException("command_line_limit_exceeded");
    }
    var environment = BuildEnvironmentBlock(specification.Environment);
    var startup = attributes.CreateStartupInfo(
      standardInput,
      stdout.Write,
      stderr.Write);
    var isolationBinding = BuildIsolationBinding(
      specification,
      context,
      executableSha256,
      executableLock.VolumeSerialNumber,
      executableLock.FileId,
      timeoutSeconds,
      outputLimit,
      _options.MaximumProcesses,
      _options.MaximumProcessMemoryBytes);
    var isolationSession = await _trustedRootIsolation.TryReserveAsync(
      isolationBinding,
      cancellationToken).ConfigureAwait(false);
    if (isolationSession is null)
    {
      throw new HostPreconditionException("trusted_root_isolation_unavailable");
    }
    await using var isolationSessionScope = isolationSession;
    var isolationReservation = isolationSession.Reservation;
    if (!PrivilegedCommandTrustedRootIsolationVerifier.ReservationMatches(
      isolationReservation,
      isolationBinding))
    {
      throw new HostPreconditionException("trusted_root_isolation_reservation_invalid");
    }

    try
    {
      await CommitIsolationEvidenceAsync(
        () => _isolationReplayStore.CommitReservationAsync(
          isolationReservation,
          cancellationToken),
        isolationReservation.LeaseSha256,
        "trusted_root_isolation_reservation_replay_invalid",
        "reservation-commit",
        mayHaveExecuted: false).ConfigureAwait(false);
      cancellationToken.ThrowIfCancellationRequested();
    }
    catch (Exception primary)
    {
      await ReleaseBeforeBindPreservingAsync(
        isolationSession,
        PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeProcess,
        primary)
        .ConfigureAwait(false);
      throw;
      throw;
    }

    NativeProcessInformation processInformation;
    try
    {
      unsafe
      {
        fixed (char* commandLinePointer = (commandLine + '\0').ToCharArray())
        fixed (char* environmentPointer = environment)
        {
          if (!CreateProcessWithAudit(
            specification.ExecutablePath,
            commandLinePointer,
            IntPtr.Zero,
            IntPtr.Zero,
            inheritHandles: true,
            CreateSuspended | CreateNoWindow | CreateUnicodeEnvironment
              | ExtendedStartupInfoPresent,
            environmentPointer,
            specification.WorkingDirectory,
            ref startup,
            out processInformation))
          {
            throw new Win32Exception(Marshal.GetLastWin32Error());
          }
        }
      }
    }
    catch (Exception primary)
    {
      await ReleaseBeforeBindPreservingAsync(
        isolationSession,
        PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeProcess,
        primary)
        .ConfigureAwait(false);
      throw;
      throw;
    }

    using var process = new SafeKernelHandle(processInformation.Process, ownsHandle: true);
    using var primaryThread = new SafeKernelHandle(processInformation.Thread, ownsHandle: true);
    var waitTask = WaitForProcessAsync(process);
    Task<StreamDigest[]>? outputTask = null;
    VerifiedPrivilegedCommandIsolationBindAcknowledgement? isolationBind = null;
    var processResumed = false;
    var terminalSettlementAttempted = false;
    try
    {
      ValidateProcessImage(process, specification.ExecutablePath);
      using (var launchedImage = SupervisorPathPolicy.OpenSystemExecutablePath(
        specification.ExecutablePath))
      {
        if (launchedImage.VolumeSerialNumber != executableLock.VolumeSerialNumber
          || launchedImage.FileId != executableLock.FileId)
        {
          throw new HostPreconditionException("command_executable_changed_during_launch");
        }
      }
      if (!IsProcessInJob(process, job, out var processInJob))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      if (!processInJob)
      {
        throw new HostPreconditionException("command_process_job_assignment_invalid");
      }

      var processObservation = new PrivilegedCommandSuspendedProcessObservation(
        Environment.ProcessId,
        GetCurrentProcessCreationTimeUtcFileTime(),
        checked((int)processInformation.ProcessId),
        GetProcessCreationTimeUtcFileTime(process),
        checked((int)processInformation.ThreadId),
        PayloadDigest.Sha256Hex(specification.ExecutablePath),
        executableSha256,
        executableLock.VolumeSerialNumber,
        executableLock.FileId,
        isolationBinding.EphemeralBinding!.Invocation.CommandLineSha256,
        PrivilegedCommandIsolationCanonical.WorkingDirectorySha256(
          specification.WorkingDirectory),
        isolationBinding.EphemeralBinding.Invocation.EnvironmentBlockSha256,
        isolationBinding.InvocationSha256,
        CreatedSuspended: true,
        AssignedToJob: true);
      isolationBind = await isolationSession.TryBindSuspendedProcessAsync(
        processObservation,
        cancellationToken).ConfigureAwait(false);
      if (isolationBind is null
        || !PrivilegedCommandTrustedRootIsolationVerifier.BindMatches(
          isolationBind,
          isolationReservation,
          processObservation))
      {
        throw new HostPreconditionException("trusted_root_isolation_bind_invalid");
      }
      await CommitIsolationEvidenceAsync(
        () => _isolationReplayStore.CommitBindAcknowledgementAsync(
          isolationBind,
          cancellationToken),
        isolationBind.AcknowledgementSha256,
        "trusted_root_isolation_bind_replay_invalid",
        "bind-commit",
        mayHaveExecuted: false).ConfigureAwait(false);

      stdout.Write.Dispose();
      stderr.Write.Dispose();
      cancellationToken.ThrowIfCancellationRequested();
      _nativeResumeAttempt();
      // Once ResumeThread is entered, a thrown/malformed native result cannot
      // prove that the transition did not occur. Settlement and coordinator
      // reporting therefore conservatively treat the child as executable.
      processResumed = true;
      var previousSuspendCount = ResumeThread(primaryThread);
      if (previousSuspendCount == uint.MaxValue)
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      if (previousSuspendCount != 1)
      {
        throw new HostPreconditionException(
          "command_primary_thread_suspend_count_invalid");
      }
      long aggregateBytes = 0;
      var stdoutTask = ReadAndHashAsync(
        stdout.Read,
        outputLimit,
        count => Interlocked.Add(ref aggregateBytes, count),
        cancellationToken);
      var stderrTask = ReadAndHashAsync(
        stderr.Read,
        outputLimit,
        count => Interlocked.Add(ref aggregateBytes, count),
        cancellationToken);
      outputTask = Task.WhenAll(stdoutTask, stderrTask);
      var first = await Task.WhenAny(waitTask, stdoutTask, stderrTask)
        .WaitAsync(cancellationToken).ConfigureAwait(false);
      if ((ReferenceEquals(first, stdoutTask) && stdoutTask.IsFaulted)
        || (ReferenceEquals(first, stderrTask) && stderrTask.IsFaulted))
      {
        _ = TerminateJobObject(job, 0xE0002001);
        await waitTask.ConfigureAwait(false);
        await outputTask.ConfigureAwait(false);
      }

      await waitTask.WaitAsync(cancellationToken).ConfigureAwait(false);
      var digests = await outputTask.WaitAsync(cancellationToken).ConfigureAwait(false);
      if (!GetExitCodeProcess(process, out var exitCode) || exitCode == StillActive)
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      var terminalOutcome = exitCode == 0
        ? PrivilegedCommandIsolationTerminalOutcomes.Completed
        : PrivilegedCommandIsolationTerminalOutcomes.Failed;
      terminalSettlementAttempted = true;
      var terminalReceipt = await SettleBoundProcessAsync(
        isolationSession,
        isolationBind,
        new PrivilegedCommandTerminalObservation(
          ProcessResumed: true,
          ExitCodeKnown: true,
          unchecked((int)exitCode),
          terminalOutcome)).ConfigureAwait(false);
      return new PrivilegedCommandResult(
        unchecked((int)exitCode),
        digests[0].ByteCount,
        digests[1].ByteCount,
        digests[0].Sha256,
        digests[1].Sha256,
        executableSha256,
        isolationReservation.Request.Action.IsolationPolicySha256,
        terminalReceipt.ReceiptSha256);
    }
    catch (Exception exception)
    {
      _ = TerminateJobObject(job, 0xE0002002);
      _ = TerminateProcess(process, 0xE0002004);
      await ObserveAsync(waitTask).ConfigureAwait(false);
      if (outputTask is not null)
      {
        await ObserveAsync(outputTask).ConfigureAwait(false);
      }

      if (isolationBind is null)
      {
        await ReleaseBeforeBindAsync(
          isolationSession,
          PrivilegedCommandIsolationPreBindReleaseOutcomes.AbortedBeforeBind)
          .ConfigureAwait(false);
      }
      else if (!terminalSettlementAttempted)
      {
        var exitCodeKnown = GetExitCodeProcess(process, out var observedExitCode)
          && observedExitCode != StillActive;
        var outcome = FailureOutcome(
          exception,
          processResumed,
          exitCodeKnown,
          observedExitCode,
          callerCancellationToken,
          timeoutCancellationToken);
        _ = await SettleBoundProcessAsync(
          isolationSession,
          isolationBind,
          new PrivilegedCommandTerminalObservation(
            processResumed,
            exitCodeKnown,
            exitCodeKnown ? unchecked((int)observedExitCode) : 0,
            outcome)).ConfigureAwait(false);
      }
      throw;
    }
    finally
    {
      _ = TerminateJobObject(job, 0xE0002003);
      _ = TerminateProcess(process, 0xE0002004);
    }
  }

  /// Key under which the losing exception is carried on the surviving one.
  private const string PreBindReleaseFailureKey = "PreBindReleaseFailure";

  /// <summary>
  /// Releases a reservation that never reached a bind, without letting the
  /// release's own failure erase the reason the run failed.
  ///
  /// The cleanup used to sit directly under <c>catch { ...; throw; }</c>. But
  /// <see cref="ReleaseBeforeBindAsync"/> rethrows rather than swallowing, so
  /// whenever the release failed the <c>throw;</c> was dead code and the first
  /// failure was replaced. That is not an edge case: when the reservation commit
  /// is what failed, there is no reservation in the ledger, the pre-bind release
  /// conflicts on <c>state is null</c> every time, and the operator is told the
  /// release was invalid instead of what actually went wrong.
  ///
  /// Which exception survives is decided on more than age. The first failure is
  /// the diagnosis and normally wins - except when it is not itself an isolation
  /// failure and the release's is. The coordinator fences on the exception TYPE,
  /// so letting a cancellation surface over an isolation-unsafe release would
  /// fence on the weaker signal. There the stricter outcome wins instead, and
  /// the original is carried on it.
  ///
  /// Either way the dispatch latch has already tripped inside the release path,
  /// so the device stays fenced no matter which of the two is raised. Only the
  /// diagnosis is at stake here - which is the whole point, because this runs
  /// when someone is trying to find out why a workstation fenced itself.
  /// </summary>
  private async ValueTask ReleaseBeforeBindPreservingAsync(
    IPrivilegedCommandTrustedRootIsolationSession isolationSession,
    string outcome,
    Exception primary)
  {
    try
    {
      await ReleaseBeforeBindAsync(isolationSession, outcome).ConfigureAwait(false);
    }
    catch (Exception releaseFailure)
    {
      if (primary is PrivilegedCommandIsolationUnsafeException)
      {
        primary.Data[PreBindReleaseFailureKey] = releaseFailure.ToString();
        return;
      }

      releaseFailure.Data[PreBindReleaseFailureKey] = primary.ToString();
      throw;
    }
  }

  private async ValueTask ReleaseBeforeBindAsync(
    IPrivilegedCommandTrustedRootIsolationSession isolationSession,
    string outcome)
  {
    using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    try
    {
      var release = await isolationSession.TryReleaseBeforeBindAsync(
        outcome,
        cleanup.Token).ConfigureAwait(false);
      if (release is null)
      {
        throw TripIsolationUnsafe(
          "trusted_root_isolation_pre_bind_release_missing",
          "pre-bind-release",
          mayHaveExecuted: false);
      }
      if (!PrivilegedCommandTrustedRootIsolationVerifier.PreBindReleaseMatches(
          release,
          isolationSession.Reservation,
          outcome))
      {
        throw TripIsolationUnsafe(
          "trusted_root_isolation_pre_bind_release_invalid",
          "pre-bind-release",
          mayHaveExecuted: false);
      }
      await CommitIsolationEvidenceAsync(
        () => _isolationReplayStore.CommitPreBindReleaseAsync(
          release,
          cleanup.Token),
        release.ReleaseSha256,
        "trusted_root_isolation_pre_bind_release_replay_invalid",
        "pre-bind-release-commit",
        mayHaveExecuted: false).ConfigureAwait(false);
    }
    catch (PrivilegedCommandIsolationUnsafeException)
    {
      _isolationDispatchLatch.Trip();
      throw;
    }
    catch (Exception exception)
    {
      throw TripIsolationUnsafe(
        "trusted_root_isolation_pre_bind_release_unavailable",
        "pre-bind-release",
        mayHaveExecuted: false,
        exception);
    }
  }

  private async ValueTask<VerifiedPrivilegedCommandIsolationTerminalReceipt>
    SettleBoundProcessAsync(
      IPrivilegedCommandTrustedRootIsolationSession isolationSession,
      VerifiedPrivilegedCommandIsolationBindAcknowledgement isolationBind,
      PrivilegedCommandTerminalObservation observation)
  {
    using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(5));
    try
    {
      var terminalReceipt = await isolationSession.TrySettleAsync(
        isolationBind,
        observation,
        cleanup.Token).ConfigureAwait(false);
      if (terminalReceipt is null
        || !PrivilegedCommandTrustedRootIsolationVerifier.TerminalReceiptMatches(
          terminalReceipt,
          isolationBind,
          observation))
      {
        throw TripIsolationUnsafe(
          "trusted_root_isolation_terminal_receipt_invalid",
          "terminal-settlement",
          observation.ProcessResumed);
      }
      await CommitIsolationEvidenceAsync(
        () => _isolationReplayStore.CommitTerminalReceiptAsync(
          terminalReceipt,
          cleanup.Token),
        terminalReceipt.ReceiptSha256,
        "trusted_root_isolation_terminal_receipt_replay_invalid",
        "terminal-commit",
        observation.ProcessResumed
          || terminalReceipt.SignedReceipt.Receipt.ProcessResumed).ConfigureAwait(false);
      if (!terminalReceipt.IsIsolationIntact)
      {
        throw TripIsolationUnsafe(
          "trusted_root_isolation_enforcement_not_continuous",
          "terminal-integrity",
          observation.ProcessResumed
            || terminalReceipt.SignedReceipt.Receipt.ProcessResumed);
      }
      return terminalReceipt;
    }
    catch (PrivilegedCommandIsolationUnsafeException)
    {
      _isolationDispatchLatch.Trip();
      throw;
    }
    catch (Exception exception)
    {
      throw TripIsolationUnsafe(
        "trusted_root_isolation_terminal_receipt_unavailable",
        "terminal-settlement",
        observation.ProcessResumed,
        exception);
    }
  }

  private async ValueTask CommitIsolationEvidenceAsync(
    Func<ValueTask<PrivilegedCommandIsolationReplayCommitResult>> commitAsync,
    string expectedEvidenceSha256,
    string errorCode,
    string phase,
    bool mayHaveExecuted)
  {
    try
    {
      var commit = await commitAsync().ConfigureAwait(false);
      if (commit.AllowsProgressFor(expectedEvidenceSha256))
      {
        return;
      }
      throw TripIsolationUnsafe(errorCode, phase, mayHaveExecuted);
    }
    catch (PrivilegedCommandIsolationUnsafeException)
    {
      _isolationDispatchLatch.Trip();
      throw;
    }
    catch (Exception exception)
    {
      throw TripIsolationUnsafe(errorCode, phase, mayHaveExecuted, exception);
    }
  }

  private PrivilegedCommandIsolationUnsafeException TripIsolationUnsafe(
    string errorCode,
    string phase,
    bool mayHaveExecuted,
    Exception? innerException = null)
  {
    _isolationDispatchLatch.Trip();
    return new PrivilegedCommandIsolationUnsafeException(
      errorCode,
      phase,
      mayHaveExecuted,
      innerException);
  }

  private static string FailureOutcome(
    Exception exception,
    bool processResumed,
    bool exitCodeKnown,
    uint exitCode,
    CancellationToken callerCancellationToken,
    CancellationToken timeoutCancellationToken)
  {
    if (exception is OperationCanceledException)
    {
      if (processResumed
        && timeoutCancellationToken.IsCancellationRequested
        && !callerCancellationToken.IsCancellationRequested)
      {
        return PrivilegedCommandIsolationTerminalOutcomes.TimedOut;
      }
      return PrivilegedCommandIsolationTerminalOutcomes.Cancelled;
    }
    if (exitCodeKnown && exitCode != 0)
    {
      return PrivilegedCommandIsolationTerminalOutcomes.Failed;
    }
    return PrivilegedCommandIsolationTerminalOutcomes.Unknown;
  }

  private void ConfigureJob(SafeJobHandle job, int maximumSeconds)
  {
    var limits = new JobObjectExtendedLimitInformation
    {
      BasicLimitInformation = new JobObjectBasicLimitInformation
      {
        PerJobUserTimeLimit = checked((long)maximumSeconds * 10_000_000),
        LimitFlags = JobObjectLimitKillOnJobClose
          | JobObjectLimitJobTime
          | JobObjectLimitActiveProcess
          | JobObjectLimitProcessMemory,
        ActiveProcessLimit = checked((uint)_options.MaximumProcesses),
      },
      ProcessMemoryLimit = checked((nuint)_options.MaximumProcessMemoryBytes),
    };
    var size = Marshal.SizeOf<JobObjectExtendedLimitInformation>();
    var buffer = Marshal.AllocHGlobal(size);
    try
    {
      Marshal.StructureToPtr(limits, buffer, fDeleteOld: false);
      if (!SetInformationJobObject(
        job,
        JobObjectExtendedLimitInformationClass,
        buffer,
        checked((uint)size)))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
    }
    finally
    {
      Marshal.FreeHGlobal(buffer);
    }
  }

  private static PrivilegedCommandIsolationRequestBinding BuildIsolationBinding(
    PrivilegedCommandSpec specification,
    ActionExecutionContext context,
    string executableSha256,
    uint executableVolumeSerialNumber,
    ulong executableFileId,
    int effectiveTimeoutSeconds,
    long effectiveMaximumOutputBytes,
    int maximumProcesses,
    long maximumProcessMemoryBytes)
  {
    if (context.ActionTokenSha256 is null
      || !PayloadDigest.IsSha256Hex(context.ActionTokenSha256)
      || context.EphemeralAuthorization is null)
    {
      throw new HostPreconditionException("command_action_authorization_required");
    }

    var environment = specification.Environment
      .OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
      .ThenBy(pair => pair.Key, StringComparer.Ordinal)
      .Select(pair => new PrivilegedCommandIsolationEnvironmentVariableV2(
        pair.Key,
        pair.Value))
      .ToArray();
    var invocationWithoutDigests = new PrivilegedCommandIsolationInvocationV2(
      PrivilegedCommandIsolationCanonical.ContractVersion,
      specification.ExecutableId,
      specification.ExecutablePath,
      executableSha256,
      executableVolumeSerialNumber,
      executableFileId,
      specification.Arguments.ToArray(),
      specification.WorkingDirectory,
      environment,
      specification.TimeoutSeconds,
      specification.MaximumOutputBytes,
      effectiveTimeoutSeconds,
      effectiveMaximumOutputBytes,
      maximumProcesses,
      maximumProcessMemoryBytes,
      string.Empty,
      string.Empty);
    var invocation = invocationWithoutDigests with
    {
      CommandLineSha256 = PayloadDigest.Sha256Hex(
        PrivilegedCommandIsolationCanonical.BuildCommandLine(invocationWithoutDigests)),
      EnvironmentBlockSha256 =
        PrivilegedCommandIsolationCanonical.EnvironmentBlockSha256(environment),
    };
    if (!PrivilegedCommandIsolationCanonical.IsValidInvocation(invocation))
    {
      throw new HostPreconditionException("command_invocation_contract_invalid");
    }
    var invocationSha256 = PrivilegedCommandIsolationCanonical.InvocationSha256(invocation);
    return new PrivilegedCommandIsolationRequestBinding(
      context.ActionId,
      context.TaskId,
      context.PlanVersionId,
      context.StepId,
      context.DeviceId,
      context.MandateId,
      context.ActionTokenSha256,
      invocationSha256,
      PayloadDigest.Sha256Hex(specification.ExecutablePath),
      executableSha256,
      new PrivilegedCommandIsolationEphemeralBinding(
        context.EphemeralAuthorization,
        invocation));
  }

  private static char[] BuildEnvironmentBlock(IReadOnlyDictionary<string, string> values) =>
    (string.Join('\0', values
      .OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
      .Select(pair => $"{pair.Key}={pair.Value}")) + "\0\0").ToCharArray();

  private unsafe bool CreateProcessWithAudit(
    string applicationName,
    char* commandLine,
    IntPtr processAttributes,
    IntPtr threadAttributes,
    bool inheritHandles,
    uint creationFlags,
    char* environment,
    string currentDirectory,
    ref StartupInfoEx startupInfo,
    out NativeProcessInformation processInformation)
  {
    _nativeLaunchAttempt();
    return CreateProcessNative(
      applicationName,
      commandLine,
      processAttributes,
      threadAttributes,
      inheritHandles,
      creationFlags,
      environment,
      currentDirectory,
      ref startupInfo,
      out processInformation);
  }

  private static SafeFileHandle OpenNullInput()
  {
    var security = new SecurityAttributes
    {
      Length = Marshal.SizeOf<SecurityAttributes>(),
      InheritHandle = true,
    };
    var handle = CreateFile(
      "NUL",
      0x80000000,
      0x00000001 | 0x00000002,
      ref security,
      3,
      0x80,
      IntPtr.Zero);
    if (handle.IsInvalid)
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    return handle;
  }

  private static void ValidateProcessImage(SafeKernelHandle process, string expectedPath)
  {
    var length = 32_768u;
    var buffer = new char[length];
    bool queried;
    unsafe
    {
      fixed (char* bufferPointer = buffer)
      {
        queried = QueryFullProcessImageName(process, 0, bufferPointer, ref length);
      }
    }
    if (!queried
      || !string.Equals(
        Path.GetFullPath(new string(buffer, 0, checked((int)length))),
        Path.GetFullPath(expectedPath),
        StringComparison.OrdinalIgnoreCase))
    {
      throw new HostPreconditionException("command_process_image_mismatch");
    }
  }

  private static long GetCurrentProcessCreationTimeUtcFileTime()
  {
    if (!GetProcessTimes(
      GetCurrentProcess(),
      out var creation,
      out _,
      out _,
      out _))
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    return ToUtcFileTime(creation);
  }

  private static long GetProcessCreationTimeUtcFileTime(SafeKernelHandle process)
  {
    if (!GetProcessTimes(process, out var creation, out _, out _, out _))
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    return ToUtcFileTime(creation);
  }

  private static long ToUtcFileTime(NativeFileTime value)
  {
    var result = checked((long)(((ulong)value.High << 32) | value.Low));
    if (result <= 0)
    {
      throw new HostPreconditionException("command_process_creation_time_invalid");
    }
    return result;
  }

  private static async Task<StreamDigest> ReadAndHashAsync(
    SafeFileHandle handle,
    long maximumBytes,
    Func<int, long> addAggregate,
    CancellationToken cancellationToken)
  {
    await using var stream = new FileStream(handle, FileAccess.Read, 8_192, isAsync: false);
    using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
    var buffer = ArrayPool<byte>.Shared.Rent(8_192);
    long count = 0;
    try
    {
      while (true)
      {
        var read = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
        if (read == 0)
        {
          break;
        }

        count = checked(count + read);
        if (addAggregate(read) > maximumBytes)
        {
          throw new InvalidDataException("command_output_limit_exceeded");
        }
        hash.AppendData(buffer, 0, read);
      }

      return new StreamDigest(
        count,
        Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant());
    }
    finally
    {
      CryptographicOperations.ZeroMemory(buffer);
      ArrayPool<byte>.Shared.Return(buffer);
    }
  }

  private static Task WaitForProcessAsync(SafeKernelHandle process)
  {
    var completion = new TaskCompletionSource(
      TaskCreationOptions.RunContinuationsAsynchronously);
    var waitHandle = new ProcessWaitHandle(process);
    RegisteredWaitHandle? registration = null;
    registration = ThreadPool.RegisterWaitForSingleObject(
      waitHandle,
      (_, _) =>
      {
        completion.TrySetResult();
        registration?.Unregister(null);
        waitHandle.Dispose();
      },
      null,
      Timeout.InfiniteTimeSpan,
      executeOnlyOnce: true);
    return completion.Task;
  }

  private static async Task ObserveAsync(Task task)
  {
    try
    {
      await task.ConfigureAwait(false);
    }
    catch
    {
      // The primary execution path retains the actionable failure.
    }
  }

  private sealed record StreamDigest(long ByteCount, string Sha256);

  private sealed class ProcessWaitHandle : WaitHandle
  {
    public ProcessWaitHandle(SafeKernelHandle process)
    {
      SafeWaitHandle = new SafeWaitHandle(
        process.DangerousGetHandle(),
        ownsHandle: false);
    }
  }

  private sealed class AnonymousPipe : IDisposable
  {
    private AnonymousPipe(SafeFileHandle read, SafeFileHandle write)
    {
      Read = read;
      Write = write;
    }

    public SafeFileHandle Read { get; }

    public SafeFileHandle Write { get; }

    public static AnonymousPipe Create()
    {
      var security = new SecurityAttributes
      {
        Length = Marshal.SizeOf<SecurityAttributes>(),
        InheritHandle = true,
      };
      if (!CreatePipe(out var read, out var write, ref security, 0))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      if (!SetHandleInformation(read, HandleFlagInherit, 0))
      {
        read.Dispose();
        write.Dispose();
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      return new AnonymousPipe(read, write);
    }

    public void Dispose()
    {
      Read.Dispose();
      Write.Dispose();
    }
  }

  private sealed class ProcessAttributeList : IDisposable
  {
    private readonly IntPtr _attributeList;
    private readonly IntPtr _handleBuffer;
    private readonly IntPtr _jobBuffer;

    private ProcessAttributeList(
      IntPtr attributeList,
      IntPtr handleBuffer,
      IntPtr jobBuffer)
    {
      _attributeList = attributeList;
      _handleBuffer = handleBuffer;
      _jobBuffer = jobBuffer;
    }

    public static ProcessAttributeList Create(
      SafeJobHandle job,
      params SafeHandle[] handles)
    {
      nuint size = 0;
      _ = InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size);
      if (size == 0)
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      var attributeList = Marshal.AllocHGlobal(checked((nint)size));
      var handleBuffer = IntPtr.Zero;
      var jobBuffer = IntPtr.Zero;
      var initialized = false;
      try
      {
        handleBuffer = Marshal.AllocHGlobal(checked(IntPtr.Size * handles.Length));
        jobBuffer = Marshal.AllocHGlobal(IntPtr.Size);
        if (!InitializeProcThreadAttributeList(attributeList, 2, 0, ref size))
        {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        initialized = true;
        for (var index = 0; index < handles.Length; index++)
        {
          Marshal.WriteIntPtr(
            handleBuffer,
            checked(index * IntPtr.Size),
            handles[index].DangerousGetHandle());
        }
        if (!UpdateProcThreadAttribute(
          attributeList,
          0,
          ProcThreadAttributeHandleList,
          handleBuffer,
          checked((nuint)(IntPtr.Size * handles.Length)),
          IntPtr.Zero,
          IntPtr.Zero))
        {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }
        Marshal.WriteIntPtr(jobBuffer, job.DangerousGetHandle());
        if (!UpdateProcThreadAttribute(
          attributeList,
          0,
          ProcThreadAttributeJobList,
          jobBuffer,
          checked((nuint)IntPtr.Size),
          IntPtr.Zero,
          IntPtr.Zero))
        {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        var result = new ProcessAttributeList(attributeList, handleBuffer, jobBuffer);
        handleBuffer = IntPtr.Zero;
        jobBuffer = IntPtr.Zero;
        return result;
      }
      catch
      {
        if (initialized)
        {
          DeleteProcThreadAttributeList(attributeList);
        }
        Marshal.FreeHGlobal(attributeList);
        throw;
      }
      finally
      {
        if (handleBuffer != IntPtr.Zero)
        {
          Marshal.FreeHGlobal(handleBuffer);
        }
        if (jobBuffer != IntPtr.Zero)
        {
          Marshal.FreeHGlobal(jobBuffer);
        }
      }
    }

    public StartupInfoEx CreateStartupInfo(
      SafeFileHandle standardInput,
      SafeFileHandle standardOutput,
      SafeFileHandle standardError) => new()
      {
        StartupInfo = new StartupInfo
        {
          Size = Marshal.SizeOf<StartupInfoEx>(),
          Flags = StartfUseStdHandles,
          StandardInput = standardInput.DangerousGetHandle(),
          StandardOutput = standardOutput.DangerousGetHandle(),
          StandardError = standardError.DangerousGetHandle(),
        },
        AttributeList = _attributeList,
      };

    public void Dispose()
    {
      DeleteProcThreadAttributeList(_attributeList);
      Marshal.FreeHGlobal(_handleBuffer);
      Marshal.FreeHGlobal(_jobBuffer);
      Marshal.FreeHGlobal(_attributeList);
    }
  }

  private sealed class SafeKernelHandle : SafeHandleZeroOrMinusOneIsInvalid
  {
    public SafeKernelHandle(IntPtr preexistingHandle, bool ownsHandle) : base(ownsHandle)
    {
      SetHandle(preexistingHandle);
    }

    protected override bool ReleaseHandle() => CloseHandle(handle);
  }

  private sealed class SafeJobHandle : SafeHandleZeroOrMinusOneIsInvalid
  {
    public SafeJobHandle(IntPtr preexistingHandle) : base(ownsHandle: true)
    {
      SetHandle(preexistingHandle);
    }

    protected override bool ReleaseHandle() => CloseHandle(handle);
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct SecurityAttributes
  {
    public int Length;
    public IntPtr SecurityDescriptor;
    [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct StartupInfo
  {
    public int Size;
    public string? Reserved;
    public string? Desktop;
    public string? Title;
    public int X;
    public int Y;
    public int XSize;
    public int YSize;
    public int XCountChars;
    public int YCountChars;
    public int FillAttribute;
    public uint Flags;
    public short ShowWindow;
    public short Reserved2Size;
    public IntPtr Reserved2;
    public IntPtr StandardInput;
    public IntPtr StandardOutput;
    public IntPtr StandardError;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct StartupInfoEx
  {
    public StartupInfo StartupInfo;
    public IntPtr AttributeList;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct NativeProcessInformation
  {
    public IntPtr Process;
    public IntPtr Thread;
    public uint ProcessId;
    public uint ThreadId;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct NativeFileTime
  {
    public uint Low;
    public uint High;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct IoCounters
  {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct JobObjectBasicLimitInformation
  {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public nuint MinimumWorkingSetSize;
    public nuint MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public nuint Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct JobObjectExtendedLimitInformation
  {
    public JobObjectBasicLimitInformation BasicLimitInformation;
    public IoCounters IoInfo;
    public nuint ProcessMemoryLimit;
    public nuint JobMemoryLimit;
    public nuint PeakProcessMemoryUsed;
    public nuint PeakJobMemoryUsed;
  }

  [DllImport(
    "kernel32.dll",
    EntryPoint = "CreateProcessW",
    ExactSpelling = true,
    SetLastError = true,
    CharSet = CharSet.Unicode)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern unsafe bool CreateProcessNative(
    string applicationName,
    char* commandLine,
    IntPtr processAttributes,
    IntPtr threadAttributes,
    [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
    uint creationFlags,
    char* environment,
    string currentDirectory,
    ref StartupInfoEx startupInfo,
    out NativeProcessInformation processInformation);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string? name);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetInformationJobObject(
    SafeJobHandle job,
    int informationClass,
    IntPtr information,
    uint informationLength);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool IsProcessInJob(
    SafeKernelHandle process,
    SafeJobHandle job,
    [MarshalAs(UnmanagedType.Bool)] out bool result);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool TerminateJobObject(SafeJobHandle job, uint exitCode);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool TerminateProcess(SafeKernelHandle process, uint exitCode);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern uint ResumeThread(SafeKernelHandle thread);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetExitCodeProcess(SafeKernelHandle process, out uint exitCode);

  [DllImport("kernel32.dll")]
  private static extern IntPtr GetCurrentProcess();

  [DllImport("kernel32.dll", EntryPoint = "GetProcessTimes", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetProcessTimes(
    IntPtr process,
    out NativeFileTime creationTime,
    out NativeFileTime exitTime,
    out NativeFileTime kernelTime,
    out NativeFileTime userTime);

  [DllImport("kernel32.dll", EntryPoint = "GetProcessTimes", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetProcessTimes(
    SafeKernelHandle process,
    out NativeFileTime creationTime,
    out NativeFileTime exitTime,
    out NativeFileTime kernelTime,
    out NativeFileTime userTime);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern unsafe bool QueryFullProcessImageName(
    SafeKernelHandle process,
    int flags,
    char* executableName,
    ref uint size);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CreatePipe(
    out SafeFileHandle readPipe,
    out SafeFileHandle writePipe,
    ref SecurityAttributes pipeAttributes,
    int size);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetHandleInformation(
    SafeFileHandle handle,
    uint mask,
    uint flags);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern SafeFileHandle CreateFile(
    string fileName,
    uint desiredAccess,
    uint shareMode,
    ref SecurityAttributes securityAttributes,
    uint creationDisposition,
    uint flagsAndAttributes,
    IntPtr templateFile);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool InitializeProcThreadAttributeList(
    IntPtr attributeList,
    int attributeCount,
    int flags,
    ref nuint size);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool UpdateProcThreadAttribute(
    IntPtr attributeList,
    uint flags,
    nuint attribute,
    IntPtr value,
    nuint size,
    IntPtr previousValue,
    IntPtr returnSize);

  [DllImport("kernel32.dll")]
  private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CloseHandle(IntPtr handle);
}

public sealed class PrivilegedCommandExecuteCapabilityAdapter : IHostCapabilityAdapter
{
  public const string CapabilityId = "command.privileged.execute";
  public const string CapabilityVersion = "1.0.0";
  public static readonly string UnboundedHostPreStateSha256 =
    PayloadDigest.Sha256Hex("msaidizi-privileged-command:unbounded-host-pre-state:v1");

  private static readonly HashSet<string> RequiredArguments = new(
    ["executable", "argv", "timeoutSeconds", "maximumOutputBytes"],
    StringComparer.Ordinal);
  private readonly PrivilegedCommandPolicy _policy;
  private readonly PrivilegedOwnedCommandRunner _runner;
  private readonly IHostRecoveryVault _recovery;

  public PrivilegedCommandExecuteCapabilityAdapter(
    PrivilegedCommandPolicy policy,
    PrivilegedOwnedCommandRunner runner,
    IHostRecoveryVault recovery)
  {
    _policy = policy;
    _runner = runner;
    _recovery = recovery;
  }

  public CapabilityDescriptor Descriptor { get; } = new(
    Id: CapabilityId,
    Version: CapabilityVersion,
    DisplayName: "Execute a privileged Windows command",
    Description: "Runs one exact argv vector through a fixed System32 Command Prompt or Windows PowerShell image in a bounded LocalSystem Job Object. Output content is represented by byte counts and SHA-256 provenance only. Expected pre-state is the unbounded-host contract sentinel 88323c68c98b95a7c22adccb1bd442c3ac1da0b06df6d582b7d747dacc3682c6. Native launch also requires an independent live trusted-root isolation attestation.",
    DataClass: CapabilityDataClass.Credential,
    Effect: CapabilityEffect.Irreversible,
    Consent: ConsentRequirement.OneShotApproval,
    Recovery: RecoveryKind.Irreversible,
    RequiredPrivilege: RequiredPrivilege.LocalSystem,
    Idempotency: IdempotencySemantics.Required,
    SupportedOperatingSystems: ["windows-11-x64"],
    ArgumentsSchema: GovernedWindowsCapabilitySupport.Parse(
      """
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "executable": { "type": "string", "enum": ["cmd", "windows-powershell"] },
          "argv": {
            "type": "array",
            "minItems": 1,
            "maxItems": 64,
            "items": { "type": "string", "maxLength": 4096 }
          },
          "timeoutSeconds": { "type": "integer", "minimum": 1, "maximum": 900 },
          "maximumOutputBytes": { "type": "integer", "minimum": 1, "maximum": 16777216 }
        },
        "required": ["executable", "argv", "timeoutSeconds", "maximumOutputBytes"],
        "additionalProperties": false
      }
      """),
    ResultSchema: GovernedWindowsCapabilitySupport.Parse(
      """
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "executable": { "type": "string", "enum": ["cmd", "windows-powershell"] },
          "exitCode": { "type": "integer" },
          "stdoutBytes": { "type": "integer", "minimum": 0, "maximum": 16777216 },
          "stderrBytes": { "type": "integer", "minimum": 0, "maximum": 16777216 },
          "stdoutSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
          "stderrSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
          "executableSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
          "isolationPolicySha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
          "isolationAttestationSha256": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
        },
        "required": ["executable", "exitCode", "stdoutBytes", "stderrBytes", "stdoutSha256", "stderrSha256", "executableSha256", "isolationPolicySha256", "isolationAttestationSha256"],
        "additionalProperties": false
      }
      """),
    ProvenanceOutputs: ["privileged-command-output"],
    TouchesTrustedRoot: false);

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments)
  {
    try
    {
      if (!HostFileSystemSupport.HasExactProperties(arguments, RequiredArguments)
        || !arguments.TryGetProperty("executable", out var executable)
        || executable.ValueKind != JsonValueKind.String
        || !arguments.TryGetProperty("argv", out var argv)
        || argv.ValueKind != JsonValueKind.Array
        || !arguments.TryGetProperty("timeoutSeconds", out var timeout)
        || !timeout.TryGetInt32(out var timeoutSeconds)
        || !arguments.TryGetProperty("maximumOutputBytes", out var output)
        || !output.TryGetInt64(out var maximumOutputBytes))
      {
        return GovernedWindowsCapabilitySupport.InvalidArguments(
          "The privileged command arguments do not match the closed schema.");
      }

      var values = argv.EnumerateArray()
        .Select(value => value.ValueKind == JsonValueKind.String
          ? value.GetString()!
          : throw new HostPolicyException("command_arguments_not_allowed"))
        .ToArray();
      _ = _policy.Resolve(
        executable.GetString()!,
        values,
        timeoutSeconds,
        maximumOutputBytes);
      return CapabilityArgumentValidation.Success;
    }
    catch (HostPolicyException exception)
    {
      return CapabilityArgumentValidation.Invalid(exception.ErrorCode, exception.Message);
    }
  }

  public CapabilityArgumentValidation ValidateResult(JsonElement result)
  {
    if (!GovernedWindowsCapabilitySupport.Exact(
        result,
        "executable",
        "exitCode",
        "stdoutBytes",
        "stderrBytes",
        "stdoutSha256",
        "stderrSha256",
        "executableSha256",
        "isolationPolicySha256",
        "isolationAttestationSha256")
      || result.GetProperty("executable").ValueKind != JsonValueKind.String
      || result.GetProperty("executable").GetString() is not ("cmd" or "windows-powershell")
      || !result.GetProperty("exitCode").TryGetInt32(out _)
      || !IsBoundedByteCount(result.GetProperty("stdoutBytes"))
      || !IsBoundedByteCount(result.GetProperty("stderrBytes"))
      || !IsSha256(result.GetProperty("stdoutSha256"))
      || !IsSha256(result.GetProperty("stderrSha256"))
      || !IsSha256(result.GetProperty("executableSha256"))
      || !IsSha256(result.GetProperty("isolationPolicySha256"))
      || !IsSha256(result.GetProperty("isolationAttestationSha256")))
    {
      return GovernedWindowsCapabilitySupport.InvalidResult(
        "The privileged command result does not match the closed schema.");
    }
    return CapabilityArgumentValidation.Success;
  }

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    if (context.ExpectedPreStateSha256 is null
      || !PayloadDigest.FixedTimeEqualsHex(
        context.ExpectedPreStateSha256,
        UnboundedHostPreStateSha256))
    {
      throw new HostPreconditionException("expected_pre_state_mismatch");
    }

    var executableId = arguments.GetProperty("executable").GetString()!;
    var argumentValues = arguments.GetProperty("argv").EnumerateArray()
      .Select(value => value.GetString()!)
      .ToArray();
    var specification = _policy.Resolve(
      executableId,
      argumentValues,
      arguments.GetProperty("timeoutSeconds").GetInt32(),
      arguments.GetProperty("maximumOutputBytes").GetInt64());
    cancellationToken.ThrowIfCancellationRequested();
    var recovery = await _recovery.PrepareAsync(
      context,
      CapabilityId,
      UnboundedHostPreStateSha256,
      new
      {
        executable = executableId,
        argvSha256 = PayloadDigest.Sha256Hex(JsonSerializer.Serialize(argumentValues)),
        specification.TimeoutSeconds,
        specification.MaximumOutputBytes,
        recovery = "none-arbitrary-command-effects-cannot-be-reconstructed",
      },
      irreversible: true,
      cancellationToken).ConfigureAwait(false);
    var executed = await _runner.RunAsync(
      specification,
      context,
      cancellationToken).ConfigureAwait(false);
    var outputJson = JsonSerializer.Serialize(new
    {
      executable = executableId,
      exitCode = executed.ExitCode,
      stdoutBytes = executed.StandardOutputBytes,
      stderrBytes = executed.StandardErrorBytes,
      stdoutSha256 = executed.StandardOutputSha256,
      stderrSha256 = executed.StandardErrorSha256,
      executableSha256 = executed.ExecutableSha256,
      isolationPolicySha256 = executed.IsolationPolicySha256,
      isolationAttestationSha256 = executed.IsolationAttestationSha256,
    });
    var contentSha256 = PayloadDigest.Sha256Hex(string.Join('\n',
      executed.ExitCode,
      executed.StandardOutputSha256,
      executed.StandardErrorSha256,
      executed.IsolationPolicySha256,
      executed.IsolationAttestationSha256));
    return new CapabilityExecutionResult(
      outputJson,
      MutationCommitted: true,
      OutcomeUncertain: true,
      Provenance:
      [
        new DataProvenance(
          "privileged-command-output",
          executed.ExecutableSha256,
          contentSha256,
          ProvenanceTrust.UntrustedContent,
          DateTimeOffset.UtcNow),
      ],
      recovery.OpaqueHandle,
      UnboundedHostPreStateSha256,
      recovery.RecordSha256,
      LocalBytesRead: checked(
        executed.StandardOutputBytes + executed.StandardErrorBytes));
  }

  private static bool IsBoundedByteCount(JsonElement value) =>
    value.TryGetInt64(out var count) && count is >= 0 and <= 16_777_216;

  private static bool IsSha256(JsonElement value) =>
    value.ValueKind == JsonValueKind.String
    && PayloadDigest.IsSha256Hex(value.GetString() ?? string.Empty);
}
