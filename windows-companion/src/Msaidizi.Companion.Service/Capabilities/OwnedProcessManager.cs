using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Microsoft.Extensions.Options;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Capabilities;

public sealed record OwnedProcessSnapshot(
  string ProcessHandle,
  int ProcessId,
  bool Running,
  uint? ExitCode,
  string StateSha256,
  string ExecutableId,
  string TaskId,
  string LaunchActionId);

internal sealed record OwnedProcessResourcePolicy(
  long MaximumJobCpuTime100Nanoseconds,
  uint MaximumProcesses,
  nuint MaximumJobMemoryBytes);

public sealed partial class OwnedProcessManager : IDisposable
{
  public static readonly string AbsentStateSha256 =
    PayloadDigest.Sha256Hex("msaidizi-owned-process:absent:v1");

  internal static OwnedProcessResourcePolicy ResourcePolicy { get; } = new(
    TimeSpan.FromHours(2).Ticks,
    MaximumProcesses: 16,
    MaximumJobMemoryBytes: 536_870_912);

  private static readonly HashSet<string> ForbiddenExecutableNames = new(
    [
      "cmd.exe",
      "powershell.exe",
      "pwsh.exe",
      "wscript.exe",
      "cscript.exe",
      "mshta.exe",
      "rundll32.exe",
      "regsvr32.exe",
    ],
    StringComparer.OrdinalIgnoreCase);
  private readonly Dictionary<string, ApprovedExecutable> _executables;
  private readonly Dictionary<string, OwnedProcess> _processes = new(StringComparer.Ordinal);
  private readonly object _gate = new();
  private readonly SupervisorPathPolicy _paths;
  private readonly int _maximumArgumentCount;
  private readonly int _maximumArgumentLength;
  private bool _disposed;

  public OwnedProcessManager(
    IOptions<HostCapabilityOptions> options,
    SupervisorPathPolicy paths)
  {
    _paths = paths;
    _maximumArgumentCount = Math.Clamp(options.Value.MaximumArgumentCount, 0, 128);
    _maximumArgumentLength = Math.Clamp(options.Value.MaximumArgumentLength, 1, 8_192);
    _executables = new Dictionary<string, ApprovedExecutable>(StringComparer.Ordinal);
    try
    {
      foreach (var configured in options.Value.AllowedExecutables)
      {
        if (string.IsNullOrWhiteSpace(configured.Id)
          || configured.Id.Length > 64
          || configured.Id.Any(character =>
            !(char.IsAsciiLetterOrDigit(character) || character is '-' or '_' or '.'))
          || _executables.ContainsKey(configured.Id))
        {
          throw new InvalidOperationException("Approved executable IDs must be unique safe identifiers.");
        }

        var executableLock = paths.OpenSupervisorExecutablePath(configured.Path);
        if (IsForbiddenExecutable(executableLock.FinalPath))
        {
          executableLock.Dispose();
          throw new InvalidOperationException(
            $"Raw shell or script-host executable '{configured.Id}' is forbidden.");
        }

        _executables.Add(configured.Id, new ApprovedExecutable(
          configured.Id,
          executableLock.FinalPath,
          configured.AllowLocalSystem,
          executableLock));
      }
    }
    catch
    {
      foreach (var executable in _executables.Values)
      {
        executable.IdentityLock.Dispose();
      }
      _executables.Clear();
      throw;
    }
  }

  public bool IsExecutableAllowed(string executableId) =>
    _executables.ContainsKey(executableId);

  public bool IsKnownHandle(string processHandle)
  {
    lock (_gate)
    {
      return _processes.ContainsKey(processHandle);
    }
  }

  public void ValidateArguments(IReadOnlyList<string> arguments)
  {
    if (arguments.Count > _maximumArgumentCount
      || arguments.Any(argument =>
        argument is null
        || argument.Length > _maximumArgumentLength
        || argument.Contains('\0')))
    {
      throw new HostPolicyException("process_arguments_invalid");
    }
  }

  public OwnedProcessSnapshot Launch(
    string executableId,
    IReadOnlyList<string> arguments,
    string workingDirectory,
    string taskId,
    string actionId,
    CancellationToken cancellationToken)
  {
    ThrowIfDisposed();
    cancellationToken.ThrowIfCancellationRequested();
    if (!_executables.TryGetValue(executableId, out var executable)
      || !executable.AllowLocalSystem)
    {
      throw new HostPreconditionException("executable_not_allowed_for_service_identity");
    }

    ValidateArguments(arguments);
    SupervisorPathPolicy.EnsureHandleStillNames(
      executable.IdentityLock,
      executable.Path);
    var job = new SafeJobHandle(NativeMethods.CreateJobObject(IntPtr.Zero, null));
    if (job.IsInvalid)
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    SafeProcessHandle? process = null;
    try
    {
      ConfigureResourceLimits(job);
      var commandLine = BuildCommandLine(executable.Path, arguments);
      var buffer = (commandLine + '\0').ToCharArray();
      var environmentBlock = BuildMinimalEnvironmentBlock(workingDirectory);
      var startup = new NativeMethods.StartupInfo
      {
        Size = checked((uint)Marshal.SizeOf<NativeMethods.StartupInfo>()),
      };
      NativeMethods.ProcessInformation processInformation;
      try
      {
        unsafe
        {
          fixed (char* commandLinePointer = buffer)
          fixed (char* environmentPointer = environmentBlock)
          {
            if (!NativeMethods.CreateProcess(
              executable.Path,
              commandLinePointer,
              IntPtr.Zero,
              IntPtr.Zero,
              inheritHandles: false,
              NativeMethods.CreateSuspended
                | NativeMethods.CreateNoWindow
                | NativeMethods.CreateUnicodeEnvironment,
              (IntPtr)environmentPointer,
              workingDirectory,
              ref startup,
              out processInformation))
            {
              throw new Win32Exception(Marshal.GetLastWin32Error());
            }
          }
        }
      }
      finally
      {
        Array.Clear(buffer);
        Array.Clear(environmentBlock);
      }

      process = new SafeProcessHandle(processInformation.Process, ownsHandle: true);
      using var primaryThread = new SafeWaitHandle(processInformation.Thread, ownsHandle: true);
      try
      {
        using var launchedImage = _paths.OpenSupervisorExecutablePath(executable.Path);
        if (launchedImage.VolumeSerialNumber != executable.IdentityLock.VolumeSerialNumber
          || launchedImage.FileId != executable.IdentityLock.FileId)
        {
          throw new HostPreconditionException("executable_changed_during_launch");
        }
      }
      catch (HostPreconditionException)
      {
        throw;
      }
      catch (Exception exception) when (exception is HostPolicyException
        or InvalidOperationException
        or IOException
        or UnauthorizedAccessException)
      {
        throw new HostPreconditionException(
          "executable_changed_during_launch",
          exception);
      }

      if (!NativeMethods.AssignProcessToJobObject(job, process))
      {
        _ = NativeMethods.TerminateProcess(process, 0xE0000001);
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      if (NativeMethods.ResumeThread(primaryThread) == uint.MaxValue)
      {
        _ = NativeMethods.TerminateJobObject(job, 0xE0000002);
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      cancellationToken.ThrowIfCancellationRequested();
      var opaqueHandle = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
      var owned = new OwnedProcess(
        opaqueHandle,
        processInformation.ProcessId,
        executable,
        arguments.ToArray(),
        workingDirectory,
        taskId,
        actionId,
        job,
        process);
      process = null;
      lock (_gate)
      {
        _processes.Add(opaqueHandle, owned);
      }

      return Snapshot(owned);
    }
    catch
    {
      if (process is not null && !process.IsInvalid)
      {
        _ = NativeMethods.TerminateProcess(process, 0xE0000003);
      }

      process?.Dispose();
      job.Dispose();
      throw;
    }
  }

  public OwnedProcessSnapshot GetStatus(string processHandle, string taskId)
  {
    ThrowIfDisposed();
    lock (_gate)
    {
      if (!_processes.TryGetValue(processHandle, out var owned))
      {
        throw new HostPreconditionException("owned_process_not_found");
      }

      EnsureTaskOwnership(owned, taskId);
      return Snapshot(owned);
    }
  }

  public OwnedProcessSnapshot Terminate(string processHandle, string taskId)
  {
    ThrowIfDisposed();
    lock (_gate)
    {
      if (!_processes.TryGetValue(processHandle, out var owned))
      {
        throw new HostPreconditionException("owned_process_not_found");
      }

      EnsureTaskOwnership(owned, taskId);
      var before = Snapshot(owned);
      if (before.Running && !NativeMethods.TerminateJobObject(owned.Job, 0xE0000100))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }

      _ = NativeMethods.WaitForSingleObject(owned.Process, 5_000);
      return Snapshot(owned);
    }
  }

  public void Dispose()
  {
    lock (_gate)
    {
      if (_disposed)
      {
        return;
      }

      _disposed = true;
      foreach (var process in _processes.Values)
      {
        process.Job.Dispose();
        process.Process.Dispose();
      }

      _processes.Clear();
      foreach (var executable in _executables.Values)
      {
        executable.IdentityLock.Dispose();
      }
      _executables.Clear();
    }
  }

  private static OwnedProcessSnapshot Snapshot(OwnedProcess process)
  {
    if (!NativeMethods.GetExitCodeProcess(process.Process, out var exitCode))
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    var running = exitCode == NativeMethods.StillActive;
    var stateSha256 = PayloadDigest.Sha256Hex(JsonSerializer.Serialize(new
    {
      process.ProcessHandle,
      process.ProcessId,
      running,
      exitCode = running ? (uint?)null : exitCode,
      process.TaskId,
      process.LaunchActionId,
      executableId = process.Executable.Id,
    }));
    return new OwnedProcessSnapshot(
      process.ProcessHandle,
      checked((int)process.ProcessId),
      running,
      running ? null : exitCode,
      stateSha256,
      process.Executable.Id,
      process.TaskId,
      process.LaunchActionId);
  }

  private static bool IsForbiddenExecutable(string executablePath)
  {
    if (ForbiddenExecutableNames.Contains(Path.GetFileName(executablePath)))
    {
      return true;
    }

    var version = FileVersionInfo.GetVersionInfo(executablePath);
    return new[] { version.OriginalFilename, version.InternalName }
      .Where(value => !string.IsNullOrWhiteSpace(value))
      .Select(value => Path.GetFileName(value!))
      .Any(value => value is not null && ForbiddenExecutableNames.Contains(value));
  }

  private static void EnsureTaskOwnership(OwnedProcess process, string taskId)
  {
    if (!string.Equals(process.TaskId, taskId, StringComparison.Ordinal))
    {
      throw new HostPreconditionException("owned_process_task_mismatch");
    }
  }

  internal static string BuildCommandLine(
    string executablePath,
    IReadOnlyList<string> arguments)
  {
    var builder = new StringBuilder();
    AppendQuotedArgument(builder, executablePath);
    foreach (var argument in arguments)
    {
      builder.Append(' ');
      AppendQuotedArgument(builder, argument);
    }

    return builder.ToString();
  }

  internal static char[] BuildMinimalEnvironmentBlock(string workingDirectory)
  {
    if (string.IsNullOrWhiteSpace(workingDirectory)
      || !Path.IsPathFullyQualified(workingDirectory)
      || workingDirectory.Contains('\0'))
    {
      throw new HostPolicyException("process_working_directory_invalid");
    }

    var systemDirectory = Path.GetFullPath(Environment.SystemDirectory);
    var windowsDirectory = Directory.GetParent(systemDirectory)?.FullName
      ?? throw new InvalidOperationException("Windows system directory has no parent.");
    var systemDrive = Path.GetPathRoot(windowsDirectory)?.TrimEnd(
      Path.DirectorySeparatorChar,
      Path.AltDirectorySeparatorChar);
    if (string.IsNullOrWhiteSpace(systemDrive))
    {
      throw new InvalidOperationException("Windows directory has no drive root.");
    }

    // Do not inherit the LocalSystem service environment. Approved child
    // processes receive only deterministic OS lookup paths and their already
    // validated working directory for temporary files.
    var entries = new[]
    {
      $"PATH={systemDirectory};{windowsDirectory}",
      $"SystemDrive={systemDrive}",
      $"SystemRoot={windowsDirectory}",
      $"TEMP={workingDirectory}",
      $"TMP={workingDirectory}",
      $"WINDIR={windowsDirectory}",
    }.OrderBy(value => value, StringComparer.OrdinalIgnoreCase);
    return (string.Join('\0', entries) + "\0\0").ToCharArray();
  }

  private static void AppendQuotedArgument(StringBuilder builder, string argument)
  {
    if (argument.Length > 0
      && !argument.Any(character => char.IsWhiteSpace(character) || character == '"'))
    {
      builder.Append(argument);
      return;
    }

    builder.Append('"');
    var backslashes = 0;
    foreach (var character in argument)
    {
      if (character == '\\')
      {
        backslashes++;
        continue;
      }

      if (character == '"')
      {
        builder.Append('\\', checked(backslashes * 2 + 1));
        builder.Append('"');
        backslashes = 0;
        continue;
      }

      builder.Append('\\', backslashes);
      backslashes = 0;
      builder.Append(character);
    }

    builder.Append('\\', checked(backslashes * 2));
    builder.Append('"');
  }

  private static void ConfigureResourceLimits(SafeJobHandle job)
  {
    var information = new NativeMethods.JobObjectExtendedLimitInformation
    {
      BasicLimitInformation = new NativeMethods.JobObjectBasicLimitInformation
      {
        PerJobUserTimeLimit = ResourcePolicy.MaximumJobCpuTime100Nanoseconds,
        ActiveProcessLimit = ResourcePolicy.MaximumProcesses,
        LimitFlags = NativeMethods.JobObjectLimitKillOnJobClose
          | NativeMethods.JobObjectLimitJobTime
          | NativeMethods.JobObjectLimitActiveProcess
          | NativeMethods.JobObjectLimitJobMemory,
      },
      JobMemoryLimit = ResourcePolicy.MaximumJobMemoryBytes,
    };
    if (!NativeMethods.SetInformationJobObject(
      job,
      NativeMethods.JobObjectExtendedLimitInformationClass,
      ref information,
      checked((uint)Marshal.SizeOf<NativeMethods.JobObjectExtendedLimitInformation>())))
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
  }

  private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);

  private sealed record ApprovedExecutable(
    string Id,
    string Path,
    bool AllowLocalSystem,
    ValidatedPathHandle IdentityLock);

  private sealed record OwnedProcess(
    string ProcessHandle,
    uint ProcessId,
    ApprovedExecutable Executable,
    IReadOnlyList<string> Arguments,
    string WorkingDirectory,
    string TaskId,
    string LaunchActionId,
    SafeJobHandle Job,
    SafeProcessHandle Process);

  private sealed class SafeJobHandle : SafeHandleZeroOrMinusOneIsInvalid
  {
    public SafeJobHandle(IntPtr preexistingHandle)
      : base(ownsHandle: true)
    {
      SetHandle(preexistingHandle);
    }

    protected override bool ReleaseHandle() => NativeMethods.CloseHandle(handle);
  }

  private static partial class NativeMethods
  {
    public const uint CreateSuspended = 0x00000004;
    public const uint CreateNoWindow = 0x08000000;
    public const uint CreateUnicodeEnvironment = 0x00000400;
    public const uint StillActive = 259;
    public const uint JobObjectLimitJobTime = 0x00000004;
    public const uint JobObjectLimitActiveProcess = 0x00000008;
    public const uint JobObjectLimitJobMemory = 0x00000200;
    public const uint JobObjectLimitKillOnJobClose = 0x00002000;
    public const int JobObjectExtendedLimitInformationClass = 9;

    [LibraryImport("kernel32.dll", EntryPoint = "CreateJobObjectW", SetLastError = true,
      StringMarshalling = StringMarshalling.Utf16)]
    public static partial IntPtr CreateJobObject(
      IntPtr jobAttributes,
      string? name);

    [LibraryImport("kernel32.dll", EntryPoint = "CreateProcessW", SetLastError = true,
      StringMarshalling = StringMarshalling.Utf16)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static unsafe partial bool CreateProcess(
      string applicationName,
      char* commandLine,
      IntPtr processAttributes,
      IntPtr threadAttributes,
      [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
      uint creationFlags,
      IntPtr environment,
      string currentDirectory,
      ref StartupInfo startupInfo,
      out ProcessInformation processInformation);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool SetInformationJobObject(
      SafeJobHandle job,
      int informationClass,
      ref JobObjectExtendedLimitInformation information,
      uint informationLength);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool AssignProcessToJobObject(
      SafeJobHandle job,
      SafeProcessHandle process);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    public static partial uint ResumeThread(SafeWaitHandle thread);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool TerminateJobObject(SafeJobHandle job, uint exitCode);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool TerminateProcess(SafeProcessHandle process, uint exitCode);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool GetExitCodeProcess(SafeProcessHandle process, out uint exitCode);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    public static partial uint WaitForSingleObject(SafeProcessHandle handle, uint milliseconds);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static partial bool CloseHandle(IntPtr handle);

    [StructLayout(LayoutKind.Sequential)]
    public unsafe struct StartupInfo
    {
      public uint Size;
      public char* Reserved;
      public char* Desktop;
      public char* Title;
      public uint X;
      public uint Y;
      public uint XSize;
      public uint YSize;
      public uint XCountChars;
      public uint YCountChars;
      public uint FillAttribute;
      public uint Flags;
      public ushort ShowWindow;
      public ushort Reserved2Length;
      public byte* Reserved2;
      public IntPtr StandardInput;
      public IntPtr StandardOutput;
      public IntPtr StandardError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ProcessInformation
    {
      public IntPtr Process;
      public IntPtr Thread;
      public uint ProcessId;
      public uint ThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JobObjectBasicLimitInformation
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
    public struct IoCounters
    {
      public ulong ReadOperationCount;
      public ulong WriteOperationCount;
      public ulong OtherOperationCount;
      public ulong ReadTransferCount;
      public ulong WriteTransferCount;
      public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct JobObjectExtendedLimitInformation
    {
      public JobObjectBasicLimitInformation BasicLimitInformation;
      public IoCounters IoInfo;
      public nuint ProcessMemoryLimit;
      public nuint JobMemoryLimit;
      public nuint PeakProcessMemoryUsed;
      public nuint PeakJobMemoryUsed;
    }
  }
}
