using System.Buffers;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Agent.Configuration;
using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Agent.Capabilities;

public sealed record StandardUserCommandSpec(
  string ExecutableId,
  string ExecutablePath,
  IReadOnlyList<string> Arguments,
  string WorkingDirectory,
  IReadOnlyDictionary<string, string> Environment);

public sealed record StandardUserCommandResult(
  int ExitCode,
  long StandardOutputBytes,
  long StandardErrorBytes,
  string StandardOutputSha256,
  string StandardErrorSha256,
  string ExecutableSha256);

/// <summary>
/// Fail-closed policy for the emergency command boundary. Executables are a
/// fixed enum, working directories are supervisor-owned aliases, no action may
/// supply environment variables, and the child receives a small reconstructed
/// environment without service, vault, token, or Codex variables.
/// </summary>
public sealed class StandardUserCommandPolicy
{
  private static readonly string[] ForbiddenArgumentMarkers =
  [
    @"\\?\",
    @"\\.\",
    @"\??\",
    "globalroot",
    "itemba\\msaidizi",
    "itemba/msaidizi",
    "secretvault",
    "recoveryvault",
    "bootstrap",
    "audit-signer",
  ];
  private readonly Dictionary<string, string> _workingDirectories;
  private readonly string[] _protectedPaths;

  public StandardUserCommandPolicy(IOptions<AgentOptions> options)
  {
    _protectedPaths = options.Value.ProtectedSupervisorPaths
      .Select(NormalizeConfiguredPath)
      .Distinct(StringComparer.OrdinalIgnoreCase)
      .ToArray();
    _workingDirectories = new Dictionary<string, string>(StringComparer.Ordinal);
    foreach (var configured in options.Value.AllowedCommandWorkingDirectories)
    {
      if (!IsSafeId(configured.Id) || _workingDirectories.ContainsKey(configured.Id))
      {
        throw new InvalidOperationException(
          "Emergency command working-directory IDs must be unique safe identifiers.");
      }

      var path = NormalizeConfiguredPath(configured.Path);
      if (_protectedPaths.Any(protectedPath => PathsOverlap(path, protectedPath)))
      {
        throw new InvalidOperationException(
          "Emergency commands cannot use a trusted-supervisor working directory.");
      }

      _workingDirectories.Add(configured.Id, path);
    }
  }

  public StandardUserCommandSpec Resolve(
    string executableId,
    IReadOnlyList<string> arguments,
    string workingDirectoryId)
  {
    if (!_workingDirectories.TryGetValue(workingDirectoryId, out var workingDirectory)
      || !Directory.Exists(workingDirectory)
      || File.GetAttributes(workingDirectory).HasFlag(FileAttributes.ReparsePoint))
    {
      throw new InvalidOperationException("command_working_directory_not_allowed");
    }

    ValidateArguments(executableId, arguments);
    var windows = Path.GetFullPath(Environment.GetFolderPath(Environment.SpecialFolder.Windows));
    var executablePath = executableId switch
    {
      "cmd" => Path.Combine(windows, "System32", "cmd.exe"),
      "windows-powershell" => Path.Combine(
        windows,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe"),
      _ => throw new InvalidOperationException("command_executable_not_allowed"),
    };
    if (!File.Exists(executablePath))
    {
      throw new InvalidOperationException("command_executable_unavailable");
    }

    return new StandardUserCommandSpec(
      executableId,
      executablePath,
      arguments.ToArray(),
      workingDirectory,
      BuildEnvironment(windows));
  }

  public static void ValidateArguments(string executableId, IReadOnlyList<string> arguments)
  {
    if (arguments.Count is < 1 or > 64
      || arguments.Any(argument => argument is null
        || argument.Length > 4_096
        || argument.Any(character => char.IsControl(character) && character != '\t'))
      || arguments.Any(argument => ForbiddenArgumentMarkers.Any(marker =>
        argument.Contains(marker, StringComparison.OrdinalIgnoreCase))))
    {
      throw new InvalidOperationException("command_arguments_not_allowed");
    }

    if (string.Equals(executableId, "cmd", StringComparison.Ordinal))
    {
      if (arguments.Count < 4
        || !string.Equals(arguments[0], "/d", StringComparison.OrdinalIgnoreCase)
        || !string.Equals(arguments[1], "/s", StringComparison.OrdinalIgnoreCase)
        || !string.Equals(arguments[2], "/c", StringComparison.OrdinalIgnoreCase))
      {
        throw new InvalidOperationException("command_cmd_prefix_required");
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
        "RemoteSigned",
        "-Command",
      ];
      if (arguments.Count <= required.Length
        || !arguments.Take(required.Length).SequenceEqual(
          required,
          StringComparer.OrdinalIgnoreCase)
        || arguments.Any(argument => argument is
          "-EncodedCommand" or "-EncodedArguments" or "-File"))
      {
        throw new InvalidOperationException("command_powershell_prefix_required");
      }
    }
    else
    {
      throw new InvalidOperationException("command_executable_not_allowed");
    }
  }

  private static Dictionary<string, string> BuildEnvironment(string windows)
  {
    var system32 = Path.Combine(windows, "System32");
    var powershell = Path.Combine(system32, "WindowsPowerShell", "v1.0");
    var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
      ["SystemRoot"] = windows,
      ["WINDIR"] = windows,
      ["COMSPEC"] = Path.Combine(system32, "cmd.exe"),
      ["PATH"] = string.Join(Path.PathSeparator, system32, windows, powershell),
      ["PATHEXT"] = ".COM;.EXE;.BAT;.CMD",
      ["PSModulePath"] = string.Join(Path.PathSeparator,
        Path.Combine(system32, "WindowsPowerShell", "v1.0", "Modules"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
          "WindowsPowerShell", "Modules")),
    };
    CopyIfPresent(values, "TEMP");
    CopyIfPresent(values, "TMP");
    CopyIfPresent(values, "USERPROFILE");
    CopyIfPresent(values, "LOCALAPPDATA");
    CopyIfPresent(values, "APPDATA");
    CopyIfPresent(values, "ProgramData");
    CopyIfPresent(values, "ProgramFiles");
    CopyIfPresent(values, "ProgramFiles(x86)");
    CopyIfPresent(values, "CommonProgramFiles");
    CopyIfPresent(values, "OS");
    CopyIfPresent(values, "PROCESSOR_ARCHITECTURE");
    CopyIfPresent(values, "NUMBER_OF_PROCESSORS");
    return values;
  }

  private static void CopyIfPresent(IDictionary<string, string> target, string name)
  {
    var value = Environment.GetEnvironmentVariable(name);
    if (!string.IsNullOrEmpty(value))
    {
      target[name] = value;
    }
  }

  private static string NormalizeConfiguredPath(string value)
  {
    var expanded = Environment.ExpandEnvironmentVariables(value);
    if (string.IsNullOrWhiteSpace(expanded) || !Path.IsPathFullyQualified(expanded))
    {
      throw new InvalidOperationException("Emergency command paths must be absolute.");
    }

    return Path.TrimEndingDirectorySeparator(Path.GetFullPath(expanded));
  }

  private static bool PathsOverlap(string first, string second) =>
    string.Equals(first, second, StringComparison.OrdinalIgnoreCase)
    || IsDescendant(first, second)
    || IsDescendant(second, first);

  private static bool IsDescendant(string candidate, string ancestor) => candidate.StartsWith(
    ancestor + Path.DirectorySeparatorChar,
    StringComparison.OrdinalIgnoreCase);

  private static bool IsSafeId(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 80
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');
}

/// <summary>
/// Standard-user-only native execution boundary. It launches suspended, pins
/// the exact executable, assigns the process tree to a kill-on-close job, then
/// resumes. Output is streamed into SHA-256 digests and never materialized as
/// text, logged, journalled, or returned to the model.
/// </summary>
public sealed partial class StandardUserOwnedCommandRunner
{
  private const uint CreateSuspended = 0x00000004;
  private const uint CreateNoWindow = 0x08000000;
  private const uint CreateUnicodeEnvironment = 0x00000400;
  private const uint ExtendedStartupInfoPresent = 0x00080000;
  private const uint StartfUseStdHandles = 0x00000100;
  private const uint HandleFlagInherit = 0x00000001;
  private const nuint ProcThreadAttributeHandleList = 0x00020002;
  private const uint JobObjectLimitJobTime = 0x00000004;
  private const uint JobObjectLimitActiveProcess = 0x00000008;
  private const uint JobObjectLimitProcessMemory = 0x00000100;
  private const uint JobObjectLimitKillOnJobClose = 0x00002000;
  private const int JobObjectExtendedLimitInformationClass = 9;
  private const uint StillActive = 259;
  private readonly AgentOptions _options;

  public StandardUserOwnedCommandRunner(IOptions<AgentOptions> options)
  {
    _options = options.Value;
  }

  public async ValueTask<StandardUserCommandResult> RunAsync(
    StandardUserCommandSpec specification,
    ActionExecutionContext context,
    CancellationToken cancellationToken)
  {
    var outputLimit = Math.Min(
      Math.Clamp(_options.MaximumCommandOutputBytes, 1, 16_777_216),
      context.Budgets.MaxLocalBytes);
    if (outputLimit <= 0)
    {
      throw new InvalidOperationException("command_output_budget_required");
    }

    using var executable = new FileStream(
      specification.ExecutablePath,
      FileMode.Open,
      FileAccess.Read,
      FileShare.Read);
    var executableSha256 = Convert.ToHexString(SHA256.HashData(executable)).ToLowerInvariant();
    executable.Position = 0;

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

    ConfigureJob(job, context.Budgets.MaxWallTimeSeconds);
    var commandLine = BuildCommandLine(
      specification.ExecutablePath,
      specification.Arguments);
    if (commandLine.Length >= 32_767)
    {
      throw new InvalidOperationException("command_line_limit_exceeded");
    }
    var environment = BuildEnvironmentBlock(specification.Environment);
    var startup = attributes.CreateStartupInfo(
      standardInput,
      stdout.Write,
      stderr.Write);
    NativeProcessInformation processInformation;
    unsafe
    {
      fixed (char* commandLinePointer = (commandLine + '\0').ToCharArray())
      fixed (char* environmentPointer = environment)
      {
        if (!CreateProcess(
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

    using var process = new SafeKernelHandle(processInformation.Process, ownsHandle: true);
    using var primaryThread = new SafeKernelHandle(processInformation.Thread, ownsHandle: true);
    var assigned = false;
    try
    {
      ValidateProcessImage(process, specification.ExecutablePath);
      if (!AssignProcessToJobObject(job, process))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      assigned = true;
      stdout.Write.Dispose();
      stderr.Write.Dispose();
      if (ResumeThread(primaryThread) == uint.MaxValue)
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      long aggregateBytes = 0;
      var stdoutTask = ReadAndHashAsync(
        stdout.Read,
        outputLimit,
        () => Interlocked.Read(ref aggregateBytes),
        count => Interlocked.Add(ref aggregateBytes, count),
        cancellationToken);
      var stderrTask = ReadAndHashAsync(
        stderr.Read,
        outputLimit,
        () => Interlocked.Read(ref aggregateBytes),
        count => Interlocked.Add(ref aggregateBytes, count),
        cancellationToken);
      var outputTask = Task.WhenAll(stdoutTask, stderrTask);
      var waitTask = WaitForProcessAsync(process, CancellationToken.None);
      try
      {
        var first = await Task.WhenAny(waitTask, stdoutTask, stderrTask)
          .WaitAsync(cancellationToken).ConfigureAwait(false);
        if ((ReferenceEquals(first, stdoutTask) && stdoutTask.IsFaulted)
          || (ReferenceEquals(first, stderrTask) && stderrTask.IsFaulted))
        {
          _ = TerminateJobObject(job, 0xE0001001);
          await waitTask.ConfigureAwait(false);
          await outputTask.ConfigureAwait(false);
        }

        await waitTask.WaitAsync(cancellationToken).ConfigureAwait(false);
        var digests = await outputTask.WaitAsync(cancellationToken).ConfigureAwait(false);
        if (!GetExitCodeProcess(process, out var exitCode) || exitCode == StillActive)
        {
          throw new Win32Exception(Marshal.GetLastWin32Error());
        }

        return new StandardUserCommandResult(
          unchecked((int)exitCode),
          digests[0].ByteCount,
          digests[1].ByteCount,
          digests[0].Sha256,
          digests[1].Sha256,
          executableSha256);
      }
      catch
      {
        _ = TerminateJobObject(job, 0xE0001002);
        await ObserveAsync(waitTask).ConfigureAwait(false);
        await ObserveAsync(outputTask).ConfigureAwait(false);
        throw;
      }
    }
    finally
    {
      if (assigned)
      {
        _ = TerminateJobObject(job, 0xE0001003);
      }
      else
      {
        _ = TerminateProcess(process, 0xE0001004);
      }
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

  private void ConfigureJob(SafeJobHandle job, long maximumSeconds)
  {
    var limits = new JobObjectExtendedLimitInformation
    {
      BasicLimitInformation = new JobObjectBasicLimitInformation
      {
        PerJobUserTimeLimit = checked(maximumSeconds * 10_000_000),
        LimitFlags = JobObjectLimitKillOnJobClose
          | JobObjectLimitJobTime
          | JobObjectLimitActiveProcess
          | JobObjectLimitProcessMemory,
        ActiveProcessLimit = checked((uint)Math.Clamp(
          _options.MaximumCommandProcesses,
          1,
          32)),
      },
      ProcessMemoryLimit = checked((nuint)Math.Clamp(
        _options.MaximumCommandWorkingSetBytes,
        67_108_864,
        2_147_483_648)),
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

  private static char[] BuildEnvironmentBlock(IReadOnlyDictionary<string, string> values) =>
    (string.Join('\0', values
      .OrderBy(pair => pair.Key, StringComparer.OrdinalIgnoreCase)
      .Select(pair => $"{pair.Key}={pair.Value}")) + "\0\0").ToCharArray();

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
      throw new InvalidOperationException("command_process_image_mismatch");
    }
  }

  private static async Task<StreamDigest> ReadAndHashAsync(
    SafeFileHandle handle,
    long maximumBytes,
    Func<long> readAggregate,
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
        var aggregate = addAggregate(read);
        if (aggregate > maximumBytes || readAggregate() > maximumBytes)
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

  private static Task WaitForProcessAsync(
    SafeKernelHandle process,
    CancellationToken cancellationToken)
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
    if (cancellationToken.CanBeCanceled)
    {
      _ = cancellationToken.Register(() => completion.TrySetCanceled(cancellationToken));
    }
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
    public SafeKernelHandle(IntPtr preexistingHandle, bool ownsHandle)
      : base(ownsHandle)
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

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern unsafe bool CreateProcess(
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
  private static extern bool GetExitCodeProcess(SafeKernelHandle process, out uint exitCode);

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

public sealed class EmergencyCommandExecuteCapabilityAdapter(
  StandardUserCommandPolicy policy,
  StandardUserOwnedCommandRunner runner) : IHostCapabilityAdapter
{
  public CapabilityDescriptor Descriptor => StandardUserCapabilityCatalog.EmergencyCommandExecute;

  public CapabilityArgumentValidation ValidateArguments(JsonElement arguments)
  {
    var shared = StandardUserCapabilityContractValidator.ValidateArguments(
      Descriptor.Id,
      arguments);
    if (!shared.IsValid)
    {
      return shared;
    }

    try
    {
      StandardUserCommandPolicy.ValidateArguments(
        arguments.GetProperty("executable").GetString()!,
        arguments.GetProperty("argv").EnumerateArray()
          .Select(argument => argument.GetString()!)
          .ToArray());
      return CapabilityArgumentValidation.Success;
    }
    catch (InvalidOperationException exception)
    {
      return InteractiveJsonValidation.Invalid(exception.Message);
    }
  }

  public CapabilityArgumentValidation ValidateResult(JsonElement result) =>
    StandardUserCapabilityContractValidator.ValidateResult(Descriptor.Id, result);

  public async ValueTask<CapabilityExecutionResult> ExecuteAsync(
    ActionExecutionContext context,
    JsonElement arguments,
    CancellationToken cancellationToken)
  {
    var executableId = arguments.GetProperty("executable").GetString()!;
    var specification = policy.Resolve(
      executableId,
      arguments.GetProperty("argv").EnumerateArray()
        .Select(argument => argument.GetString()!)
        .ToArray(),
      arguments.GetProperty("workingDirectoryId").GetString()!);
    var executed = await runner.RunAsync(
      specification,
      context,
      cancellationToken).ConfigureAwait(false);
    var output = JsonSerializer.Serialize(new
    {
      executable = executableId,
      exitCode = executed.ExitCode,
      stdoutBytes = executed.StandardOutputBytes,
      stderrBytes = executed.StandardErrorBytes,
      stdoutSha256 = executed.StandardOutputSha256,
      stderrSha256 = executed.StandardErrorSha256,
    });
    var contentDigest = PayloadDigest.Sha256Hex(string.Join('\n',
      executed.ExitCode,
      executed.StandardOutputSha256,
      executed.StandardErrorSha256));
    return new CapabilityExecutionResult(
      output,
      MutationCommitted: true,
      // Arbitrary commands can change state outside the adapter's observation.
      OutcomeUncertain: true,
      Provenance:
      [
        new DataProvenance(
          "standard-user-command-output",
          executed.ExecutableSha256,
          contentDigest,
          ProvenanceTrust.UntrustedContent,
          DateTimeOffset.UtcNow),
      ],
      LocalBytesRead: checked(
        executed.StandardOutputBytes + executed.StandardErrorBytes));
  }
}
