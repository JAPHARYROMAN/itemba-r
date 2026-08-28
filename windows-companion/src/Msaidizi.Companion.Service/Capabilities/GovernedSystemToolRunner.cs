using System.Buffers;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

internal enum GovernedSystemTool
{
  ScheduledTasks,
  WindowsInstaller,
}

internal enum GovernedSystemToolStage
{
  CreatedSuspended,
  ImageVerified,
  JobAssigned,
  BeforeResume,
  Resumed,
  JobTerminated,
}

internal sealed record GovernedCommandResult(
  int ExitCode,
  string StandardOutput,
  string StandardError);

internal sealed record GovernedSystemToolDefinition(
  string ExecutablePath,
  Action<IReadOnlyList<string>> ValidateArguments);

/// <summary>
/// Runs the two reviewed Windows administrative tools without path lookup or
/// shell resolution. The exact System32 image is locked, created suspended,
/// reverified, assigned to a kill-on-close Job Object, and only then resumed.
/// </summary>
internal sealed class GovernedSystemToolRunner : IDisposable
{
  private const uint CreateSuspended = 0x00000004;
  private const uint CreateNoWindow = 0x08000000;
  private const uint ExtendedStartupInfoPresent = 0x00080000;
  private const uint StartfUseStdHandles = 0x00000100;
  private const uint HandleFlagInherit = 0x00000001;
  private const nuint ProcThreadAttributeHandleList = 0x00020002;
  private const uint JobObjectLimitKillOnJobClose = 0x00002000;
  private const int JobObjectExtendedLimitInformationClass = 9;
  private const uint StillActive = 259;

  private readonly Dictionary<GovernedSystemTool, ResolvedTool> _tools;
  private readonly HashSet<SafeJobHandle> _activeJobs = [];
  private readonly Action<GovernedSystemToolStage> _stageObserver;
  private readonly object _gate = new();
  private bool _disposed;

  public GovernedSystemToolRunner()
    : this(CreateProductionDefinitions(), static _ => { })
  {
  }

  internal GovernedSystemToolRunner(
    IReadOnlyDictionary<GovernedSystemTool, GovernedSystemToolDefinition> definitions,
    Action<GovernedSystemToolStage>? stageObserver = null)
  {
    _stageObserver = stageObserver ?? (static _ => { });
    _tools = new Dictionary<GovernedSystemTool, ResolvedTool>();
    foreach (var tool in Enum.GetValues<GovernedSystemTool>())
    {
      if (!definitions.TryGetValue(tool, out var definition))
      {
        throw new InvalidOperationException("Every governed system tool must be defined.");
      }

      var expectedPath = Path.GetFullPath(definition.ExecutablePath);
      using (var identityLock = SupervisorPathPolicy.OpenSystemExecutablePath(expectedPath))
      {
        if (!string.Equals(
          identityLock.FinalPath,
          expectedPath,
          StringComparison.OrdinalIgnoreCase))
        {
          throw new HostPreconditionException("trusted_system_binary_unavailable");
        }
      }

      _tools.Add(tool, new ResolvedTool(
        expectedPath,
        definition.ValidateArguments));
    }

    if (definitions.Count != _tools.Count)
    {
      throw new InvalidOperationException("Unknown governed system tools are forbidden.");
    }
  }

  public async ValueTask<GovernedCommandResult> RunAsync(
    GovernedSystemTool tool,
    IReadOnlyList<string> arguments,
    int maximumOutputBytes,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    var lockedTool = Resolve(tool);
    if (maximumOutputBytes is < 1 or > 1_048_576)
    {
      throw new HostPolicyException("trusted_system_command_output_limit_invalid");
    }

    lockedTool.ValidateArguments(arguments);
    using var executableLock = SupervisorPathPolicy.OpenSystemExecutablePath(
      lockedTool.ExecutablePath);
    SupervisorPathPolicy.EnsureHandleStillNames(
      executableLock,
      lockedTool.ExecutablePath);
    var commandLine = BuildCommandLine(lockedTool.ExecutablePath, arguments);
    if (commandLine.Length >= 32_767)
    {
      throw new HostPolicyException("trusted_system_command_line_limit_exceeded");
    }

    using var stdout = AnonymousPipe.Create();
    using var stderr = AnonymousPipe.Create();
    using var standardInput = OpenNullInput();
    using var attributes = ProcessAttributeList.Create(
      standardInput,
      stdout.Write,
      stderr.Write);
    using var job = new SafeJobHandle(CreateJobObject(IntPtr.Zero, null));
    if (job.IsInvalid)
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    ConfigureKillOnClose(job);
    RegisterJob(job);
    using var cancellationRegistration = cancellationToken.UnsafeRegister(
      static state =>
      {
        var registeredJob = (SafeJobHandle)state!;
        lock (registeredJob)
        {
          if (!registeredJob.IsClosed && !registeredJob.IsInvalid)
          {
            _ = TerminateJobObject(registeredJob, 0xE0003001);
          }
        }
      },
      job);

    SafeKernelHandle? process = null;
    Task<string>? stdoutTask = null;
    Task<string>? stderrTask = null;
    Task? waitTask = null;
    var assigned = false;
    try
    {
      var startup = attributes.CreateStartupInfo(
        standardInput,
        stdout.Write,
        stderr.Write);
      NativeProcessInformation processInformation;
      unsafe
      {
        fixed (char* commandLinePointer = (commandLine + '\0').ToCharArray())
        {
          if (!CreateProcessNative(
            lockedTool.ExecutablePath,
            commandLinePointer,
            IntPtr.Zero,
            IntPtr.Zero,
            inheritHandles: true,
            CreateSuspended | CreateNoWindow | ExtendedStartupInfoPresent,
            IntPtr.Zero,
            Environment.SystemDirectory,
            ref startup,
            out processInformation))
          {
            throw new Win32Exception(Marshal.GetLastWin32Error());
          }
        }
      }

      process = new SafeKernelHandle(processInformation.Process, ownsHandle: true);
      using var primaryThread = new SafeKernelHandle(
        processInformation.Thread,
        ownsHandle: true);
      _stageObserver(GovernedSystemToolStage.CreatedSuspended);
      ValidateProcessImage(process, lockedTool.ExecutablePath);
      using (var launchedImage = SupervisorPathPolicy.OpenSystemExecutablePath(
        lockedTool.ExecutablePath))
      {
        if (launchedImage.VolumeSerialNumber != executableLock.VolumeSerialNumber
          || launchedImage.FileId != executableLock.FileId)
        {
          throw new HostPreconditionException(
            "trusted_system_binary_changed_during_launch");
        }
      }
      _stageObserver(GovernedSystemToolStage.ImageVerified);

      cancellationToken.ThrowIfCancellationRequested();
      ThrowIfDisposed();
      if (!AssignProcessToJobObject(job, process))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      assigned = true;
      _stageObserver(GovernedSystemToolStage.JobAssigned);

      stdout.Write.Dispose();
      stderr.Write.Dispose();
      _stageObserver(GovernedSystemToolStage.BeforeResume);
      cancellationToken.ThrowIfCancellationRequested();
      ThrowIfDisposed();
      if (ResumeThread(primaryThread) == uint.MaxValue)
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      _stageObserver(GovernedSystemToolStage.Resumed);

      long aggregateOutputBytes = 0;
      stdoutTask = ReadBoundedAsync(
        stdout.Read,
        maximumOutputBytes,
        count => Interlocked.Add(ref aggregateOutputBytes, count),
        cancellationToken);
      stderrTask = ReadBoundedAsync(
        stderr.Read,
        maximumOutputBytes,
        count => Interlocked.Add(ref aggregateOutputBytes, count),
        cancellationToken);
      waitTask = WaitForProcessAsync(process);
      var outputFailure = new TaskCompletionSource(
        TaskCreationOptions.RunContinuationsAsynchronously);
      ForwardFailure(stdoutTask, outputFailure);
      ForwardFailure(stderrTask, outputFailure);
      var first = await Task.WhenAny(waitTask, outputFailure.Task)
        .WaitAsync(cancellationToken).ConfigureAwait(false);
      if (!ReferenceEquals(first, waitTask))
      {
        await first.ConfigureAwait(false);
      }

      await waitTask.WaitAsync(cancellationToken).ConfigureAwait(false);
      if (!GetExitCodeProcess(process, out var exitCode) || exitCode == StillActive)
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      // The reviewed tools have completed. Closing out their Job now prevents
      // an inherited handle or unexpected descendant from extending the step.
      CloseJob(job, 0xE0003002);
      var output = await Task.WhenAll(stdoutTask, stderrTask)
        .WaitAsync(cancellationToken).ConfigureAwait(false);
      ThrowIfDisposed();
      return new GovernedCommandResult(
        unchecked((int)exitCode),
        output[0],
        output[1]);
    }
    catch
    {
      if (assigned)
      {
        CloseJob(job, 0xE0003003);
      }
      else if (process is not null && !process.IsInvalid)
      {
        _ = TerminateProcess(process, 0xE0003004);
      }

      if (waitTask is not null)
      {
        await ObserveAsync(waitTask).ConfigureAwait(false);
      }
      if (stdoutTask is not null)
      {
        await ObserveAsync(stdoutTask).ConfigureAwait(false);
      }
      if (stderrTask is not null)
      {
        await ObserveAsync(stderrTask).ConfigureAwait(false);
      }
      throw;
    }
    finally
    {
      if (assigned)
      {
        CloseJob(job, 0xE0003005);
      }
      else if (process is not null && !process.IsInvalid)
      {
        _ = TerminateProcess(process, 0xE0003006);
      }

      process?.Dispose();
      UnregisterJob(job);
    }
  }

  public void Dispose()
  {
    SafeJobHandle[] jobs;
    lock (_gate)
    {
      if (_disposed)
      {
        return;
      }

      _disposed = true;
      jobs = [.. _activeJobs];
    }

    foreach (var job in jobs)
    {
      lock (job)
      {
        if (!job.IsClosed && !job.IsInvalid)
        {
          _ = TerminateJobObject(job, 0xE0003007);
          job.Dispose();
        }
      }
    }
  }

  internal string GetExecutablePath(GovernedSystemTool tool) => Resolve(tool).ExecutablePath;

  private static Dictionary<GovernedSystemTool, GovernedSystemToolDefinition>
    CreateProductionDefinitions() =>
      new Dictionary<GovernedSystemTool, GovernedSystemToolDefinition>
      {
        [GovernedSystemTool.ScheduledTasks] = new(
          Path.Combine(Environment.SystemDirectory, "schtasks.exe"),
          ValidateScheduledTaskArguments),
        [GovernedSystemTool.WindowsInstaller] = new(
          Path.Combine(Environment.SystemDirectory, "msiexec.exe"),
          ValidateWindowsInstallerArguments),
      };

  private static void ValidateScheduledTaskArguments(IReadOnlyList<string> arguments)
  {
    ValidateCommonArguments(arguments);
    var valid = arguments.Count == 5
      && EqualsSwitch(arguments[0], "/Query")
      && EqualsSwitch(arguments[1], "/TN")
      && IsScheduledTaskPath(arguments[2])
      && EqualsSwitch(arguments[3], "/XML")
      && EqualsSwitch(arguments[4], "ONE")
      || arguments.Count == 4
      && EqualsSwitch(arguments[0], "/Change")
      && EqualsSwitch(arguments[1], "/TN")
      && IsScheduledTaskPath(arguments[2])
      && (EqualsSwitch(arguments[3], "/ENABLE")
        || EqualsSwitch(arguments[3], "/DISABLE"))
      || arguments.Count == 3
      && EqualsSwitch(arguments[0], "/Run")
      && EqualsSwitch(arguments[1], "/TN")
      && IsScheduledTaskPath(arguments[2]);
    if (!valid)
    {
      throw new HostPolicyException("trusted_system_command_arguments_invalid");
    }
  }

  private static void ValidateWindowsInstallerArguments(IReadOnlyList<string> arguments)
  {
    ValidateCommonArguments(arguments);
    var commonSuffix = arguments.Count == 5
      && EqualsSwitch(arguments[2], "/qn")
      && EqualsSwitch(arguments[3], "/norestart")
      && EqualsSwitch(arguments[4], "REBOOT=ReallySuppress");
    var valid = commonSuffix
      && EqualsSwitch(arguments[0], "/i")
      && Path.IsPathFullyQualified(arguments[1])
      && string.Equals(
        Path.GetExtension(arguments[1]),
        ".msi",
        StringComparison.OrdinalIgnoreCase)
      || commonSuffix
      && EqualsSwitch(arguments[0], "/x")
      && Guid.TryParseExact(arguments[1], "B", out _);
    if (!valid)
    {
      throw new HostPolicyException("trusted_system_command_arguments_invalid");
    }
  }

  private static void ValidateCommonArguments(IReadOnlyList<string> arguments)
  {
    if (arguments is null
      || arguments.Count is < 1 or > 8
      || arguments.Any(argument =>
        argument is null
        || argument.Length > 32_000
        || argument.Contains('\0')))
    {
      throw new HostPolicyException("trusted_system_command_arguments_invalid");
    }
  }

  private static bool IsScheduledTaskPath(string value) =>
    value.Length is >= 1 and <= 512
    && value.StartsWith('\\')
    && !value.Contains('/')
    && !value.Contains("..", StringComparison.Ordinal)
    && !value.Contains('\0');

  private static bool EqualsSwitch(string left, string right) =>
    string.Equals(left, right, StringComparison.OrdinalIgnoreCase);

  private ResolvedTool Resolve(GovernedSystemTool tool)
  {
    lock (_gate)
    {
      ThrowIfDisposedNoLock();
      if (!_tools.TryGetValue(tool, out var lockedTool))
      {
        throw new HostPolicyException("trusted_system_tool_not_allowed");
      }
      return lockedTool;
    }
  }

  private void RegisterJob(SafeJobHandle job)
  {
    lock (_gate)
    {
      ThrowIfDisposedNoLock();
      _activeJobs.Add(job);
    }
  }

  private void UnregisterJob(SafeJobHandle job)
  {
    lock (_gate)
    {
      _activeJobs.Remove(job);
    }
  }

  private void ThrowIfDisposed()
  {
    lock (_gate)
    {
      ThrowIfDisposedNoLock();
    }
  }

  private void ThrowIfDisposedNoLock() =>
    ObjectDisposedException.ThrowIf(_disposed, this);

  private void CloseJob(SafeJobHandle job, uint exitCode)
  {
    lock (job)
    {
      if (!job.IsClosed && !job.IsInvalid)
      {
        try
        {
          _ = TerminateJobObject(job, exitCode);
          _stageObserver(GovernedSystemToolStage.JobTerminated);
        }
        finally
        {
          // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE is the native fallback if an
          // explicit termination races or fails.
          job.Dispose();
        }
      }
    }
  }

  private static void ConfigureKillOnClose(SafeJobHandle job)
  {
    var information = new JobObjectExtendedLimitInformation
    {
      BasicLimitInformation = new JobObjectBasicLimitInformation
      {
        LimitFlags = JobObjectLimitKillOnJobClose,
      },
    };
    if (!SetInformationJobObject(
      job,
      JobObjectExtendedLimitInformationClass,
      ref information,
      checked((uint)Marshal.SizeOf<JobObjectExtendedLimitInformation>())))
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
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
        queried = QueryFullProcessImageName(
          process,
          0,
          bufferPointer,
          ref length);
      }
    }
    if (!queried
      || !string.Equals(
        Path.GetFullPath(new string(buffer, 0, checked((int)length))),
        Path.GetFullPath(expectedPath),
        StringComparison.OrdinalIgnoreCase))
    {
      throw new HostPreconditionException("trusted_system_process_image_mismatch");
    }
  }

  private static async Task<string> ReadBoundedAsync(
    SafeFileHandle handle,
    long maximumBytes,
    Func<int, long> addAggregate,
    CancellationToken cancellationToken)
  {
    await using var stream = new FileStream(handle, FileAccess.Read, 8_192, isAsync: false);
    using var output = new MemoryStream();
    var buffer = ArrayPool<byte>.Shared.Rent(8_192);
    try
    {
      while (true)
      {
        var read = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
        if (read == 0)
        {
          break;
        }

        if (addAggregate(read) > maximumBytes)
        {
          throw new InvalidDataException(
            "trusted_system_command_output_exceeded_limit");
        }
        await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken)
          .ConfigureAwait(false);
      }

      var result = Encoding.Unicode.GetString(output.GetBuffer(), 0, checked((int)output.Length));
      return result.Length > 0 && result[0] == '\uFEFF' ? result[1..] : result;
    }
    finally
    {
      Array.Clear(buffer);
      ArrayPool<byte>.Shared.Return(buffer);
    }
  }

  private static void ForwardFailure(Task task, TaskCompletionSource failure)
  {
    _ = task.ContinueWith(
      static (completed, state) =>
      {
        var target = (TaskCompletionSource)state!;
        if (completed.IsFaulted)
        {
          target.TrySetException(completed.Exception!.InnerExceptions);
        }
        else if (completed.IsCanceled)
        {
          target.TrySetCanceled();
        }
      },
      failure,
      CancellationToken.None,
      TaskContinuationOptions.ExecuteSynchronously,
      TaskScheduler.Default);
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
      // Preserve the actionable execution failure from the primary path.
    }
  }

  internal static string BuildCommandLine(
    string executablePath,
    IReadOnlyList<string> arguments) => string.Join(
    ' ',
    new[] { executablePath }.Concat(arguments).Select(QuoteArgument));

  private static string QuoteArgument(string argument)
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

  private sealed record ResolvedTool(
    string ExecutablePath,
    Action<IReadOnlyList<string>> ValidateArguments);

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

    private ProcessAttributeList(IntPtr attributeList, IntPtr handleBuffer)
    {
      _attributeList = attributeList;
      _handleBuffer = handleBuffer;
    }

    public static ProcessAttributeList Create(params SafeHandle[] handles)
    {
      nuint size = 0;
      _ = InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
      if (size == 0)
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      var attributeList = Marshal.AllocHGlobal(checked((nint)size));
      var handleBuffer = Marshal.AllocHGlobal(checked(IntPtr.Size * handles.Length));
      var initialized = false;
      try
      {
        if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref size))
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

        var result = new ProcessAttributeList(attributeList, handleBuffer);
        handleBuffer = IntPtr.Zero;
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
    IntPtr environment,
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
    ref JobObjectExtendedLimitInformation information,
    uint informationLength);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool AssignProcessToJobObject(
    SafeJobHandle job,
    SafeKernelHandle process);

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
  private static extern bool GetExitCodeProcess(
    SafeKernelHandle process,
    out uint exitCode);

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
