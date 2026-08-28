using System.Buffers.Binary;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Channel;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Enforcement;

internal sealed record PrivilegedCommandProcessTerminalFacts(
  bool ProcessTreeTerminal,
  bool ExitCodeKnown,
  int ExitCode,
  long EndedAtUnixMilliseconds);

internal interface IPrivilegedCommandProcessLease : IAsyncDisposable
{
  Guid JobObjectId { get; }

  string JobObjectIdentitySha256 { get; }

  NetworkIsolationProcessEnrollmentV3 Enrollment { get; }

  ValueTask<PrivilegedCommandProcessTerminalFacts> EnsureTerminalAsync(
    bool terminate,
    CancellationToken cancellationToken);
}

internal interface IPrivilegedCommandProcessLeaseFactory
{
  ValueTask<IPrivilegedCommandProcessLease> AcquireAsync(
    SuspendedProcessObservation observation,
    PrivilegedCommandIsolationInvocationV2 invocation,
    ulong enrollmentExpiresAtFileTime100ns,
    CancellationToken cancellationToken);
}

/// <summary>
/// Independently reopens and measures the still-suspended child, derives the
/// exact process identity expected by the v3 driver, and assigns it to a
/// supervisor-owned nested job with KILL_ON_JOB_CLOSE before enrollment. The
/// companion's outer job remains an independent safety layer.
/// </summary>
internal sealed class WindowsPrivilegedCommandProcessLeaseFactory :
  IPrivilegedCommandProcessLeaseFactory
{
  private readonly TimeSpan _operationTimeout;

  public WindowsPrivilegedCommandProcessLeaseFactory(TimeSpan operationTimeout)
  {
    _operationTimeout = operationTimeout;
  }

  public ValueTask<IPrivilegedCommandProcessLease> AcquireAsync(
    SuspendedProcessObservation observation,
    PrivilegedCommandIsolationInvocationV2 invocation,
    ulong enrollmentExpiresAtFileTime100ns,
    CancellationToken cancellationToken)
  {
    ArgumentNullException.ThrowIfNull(observation);
    ArgumentNullException.ThrowIfNull(invocation);
    cancellationToken.ThrowIfCancellationRequested();
    if (!OperatingSystem.IsWindows())
    {
      throw new PlatformNotSupportedException(
        "Privileged-command process leases exist only on Windows.");
    }

    var process = OpenProcess(
      ProcessQueryInformation | ProcessQueryLimitedInformation
        | ProcessSetQuota | ProcessTerminate
        | Synchronize,
      inheritHandle: false,
      checked((uint)observation.ChildProcessId));
    if (process.IsInvalid)
    {
      var error = Marshal.GetLastWin32Error();
      process.Dispose();
      throw new Win32Exception(error, "The suspended child could not be reopened.");
    }
    SafeJobHandle? job = null;
    LockedExecutableIdentity? executableIdentity = null;
    try
    {
      var creationTime = GetCreationTime(process);
      if (creationTime != checked((ulong)observation.ChildProcessCreationTimeUtcFileTime))
      {
        throw new UnauthorizedAccessException(
          "The suspended child creation identity changed before v3 enrollment.");
      }
      var livePath = QueryProcessImagePath(process);
      if (!string.Equals(
        Path.GetFullPath(livePath),
        Path.GetFullPath(invocation.ExecutablePath),
        StringComparison.OrdinalIgnoreCase))
      {
        throw new UnauthorizedAccessException(
          "The suspended child executable path changed before v3 enrollment.");
      }
      executableIdentity = OpenAndVerifyExecutableIdentity(
        invocation.ExecutablePath,
        observation.ImageSha256,
        observation.ImageVolumeSerialNumber,
        observation.ImageFileId);
      var imageSha256 = executableIdentity.ImageSha256;
      var imageNtPath = executableIdentity.NormalizedNtPath;
      var appId = QueryWfpApplicationId(invocation.ExecutablePath);
      executableIdentity.RequireWfpApplicationIdMatches(
        appId,
        observation.ImageVolumeSerialNumber,
        observation.ImageFileId);
      if (!string.Equals(
        Path.GetFullPath(QueryProcessImagePath(process)),
        Path.GetFullPath(invocation.ExecutablePath),
        StringComparison.OrdinalIgnoreCase))
      {
        throw new UnauthorizedAccessException(
          "The suspended child image path drifted during WFP identity derivation.");
      }
      var processStartKey = QueryProcessStartKey(process, observation.ChildProcessId);
      var processIdentitySha256 = NetworkIsolationProtocolV3.ComputeProcessIdentitySha256(
        checked((ulong)observation.ChildProcessId),
        creationTime,
        processStartKey,
        imageSha256,
        imageNtPath,
        appId);

      job = new SafeJobHandle(CreateJobObject(IntPtr.Zero, null));
      if (job.IsInvalid)
      {
        throw new Win32Exception(
          Marshal.GetLastWin32Error(),
          "The supervisor-owned nested job could not be created.");
      }
      ConfigureKillOnClose(job);
      if (!AssignProcessToJobObject(job, process))
      {
        throw new Win32Exception(
          Marshal.GetLastWin32Error(),
          "The suspended child could not be assigned to the supervisor-owned nested job.");
      }
      if (!IsProcessInJob(process, job, out var assigned) || !assigned)
      {
        throw new UnauthorizedAccessException(
          "The supervisor-owned nested job assignment could not be proven.");
      }

      var jobId = Guid.NewGuid();
      var nonce = RandomNumberGenerator.GetBytes(32);
      var scalar = new byte[40];
      jobId.TryWriteBytes(scalar.AsSpan(0, 16));
      BinaryPrimitives.WriteUInt64LittleEndian(
        scalar.AsSpan(16, 8),
        checked((ulong)observation.ChildProcessId));
      BinaryPrimitives.WriteUInt64LittleEndian(scalar.AsSpan(24, 8), creationTime);
      BinaryPrimitives.WriteUInt64LittleEndian(scalar.AsSpan(32, 8), processStartKey);
      var jobIdentity = NetworkIsolationProtocolV3.Sha256Hex(
        scalar,
        nonce,
        processIdentitySha256);
      CryptographicOperations.ZeroMemory(scalar);
      CryptographicOperations.ZeroMemory(nonce);
      var enrollment = new NetworkIsolationProcessEnrollmentV3(
        checked((ulong)observation.ChildProcessId),
        creationTime,
        processStartKey,
        enrollmentExpiresAtFileTime100ns,
        imageSha256,
        processIdentitySha256,
        imageNtPath,
        appId);
      var lease = new WindowsPrivilegedCommandProcessLease(
        process,
        job,
        jobId,
        jobIdentity,
        enrollment,
        executableIdentity,
        _operationTimeout);
      job = null;
      executableIdentity = null;
      return ValueTask.FromResult<IPrivilegedCommandProcessLease>(lease);
    }
    catch
    {
      if (job is not null && !job.IsInvalid)
      {
        _ = TerminateJobObject(job, IsolationFailureExitCode);
      }
      job?.Dispose();
      executableIdentity?.Dispose();
      process.Dispose();
      throw;
    }
  }

  private static ulong GetCreationTime(SafeProcessHandle process)
  {
    if (!GetProcessTimes(
      process,
      out var creation,
      out _,
      out _,
      out _))
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    return checked(((ulong)creation.HighDateTime << 32) | creation.LowDateTime);
  }

  private static string QueryProcessImagePath(SafeProcessHandle process)
  {
    var capacity = 32_768;
    var value = new char[capacity];
    if (!QueryFullProcessImageName(process, 0, value, ref capacity))
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    return new string(value, 0, capacity);
  }

  internal static MeasuredExecutableIdentity MeasureExecutableIdentity(string path)
  {
    using var file = new FileStream(
      path,
      FileMode.Open,
      FileAccess.Read,
      FileShare.ReadWrite | FileShare.Delete);
    var (volumeSerialNumber, fileId) = QueryFileIdentity(file.SafeFileHandle);
    return new MeasuredExecutableIdentity(
      volumeSerialNumber,
      fileId,
      Convert.ToHexString(SHA256.HashData(file)).ToLowerInvariant());
  }

  internal static LockedExecutableIdentity OpenAndVerifyExecutableIdentity(
    string path,
    string expectedSha256,
    uint expectedVolumeSerialNumber,
    ulong expectedFileId)
  {
    var file = new FileStream(
      path,
      FileMode.Open,
      FileAccess.Read,
      FileShare.Read);
    try
    {
      var (volumeSerialNumber, fileId) = QueryFileIdentity(file.SafeFileHandle);
      if (volumeSerialNumber != expectedVolumeSerialNumber || fileId != expectedFileId)
      {
        throw new UnauthorizedAccessException(
          "The executable file identity changed before v3 enrollment.");
      }
      var measured = SHA256.HashData(file);
      var expected = Convert.FromHexString(expectedSha256);
      try
      {
        if (!CryptographicOperations.FixedTimeEquals(measured, expected))
        {
          throw new UnauthorizedAccessException(
            "The executable image measurement changed before v3 enrollment.");
        }
      }
      finally
      {
        CryptographicOperations.ZeroMemory(expected);
      }
      var ntPath = QueryNormalizedNtImagePath(file.SafeFileHandle);
      return new LockedExecutableIdentity(
        file,
        volumeSerialNumber,
        fileId,
        measured,
        ntPath);
    }
    catch
    {
      file.Dispose();
      throw;
    }
  }

  internal sealed record MeasuredExecutableIdentity(
    uint VolumeSerialNumber,
    ulong FileId,
    string Sha256);

  internal sealed class LockedExecutableIdentity : IDisposable
  {
    private readonly FileStream _file;
    private readonly uint _volumeSerialNumber;
    private readonly ulong _fileId;
    private int _disposed;

    internal LockedExecutableIdentity(
      FileStream file,
      uint volumeSerialNumber,
      ulong fileId,
      byte[] imageSha256,
      string normalizedNtPath)
    {
      _file = file;
      _volumeSerialNumber = volumeSerialNumber;
      _fileId = fileId;
      ImageSha256 = imageSha256;
      NormalizedNtPath = normalizedNtPath;
    }

    internal byte[] ImageSha256 { get; }

    internal string NormalizedNtPath { get; }

    internal void RequireWfpApplicationIdMatches(
      byte[] applicationId,
      uint expectedVolumeSerialNumber,
      ulong expectedFileId)
    {
      ArgumentNullException.ThrowIfNull(applicationId);
      RequireStillSame(expectedVolumeSerialNumber, expectedFileId);
      if (applicationId.Length < 4
        || applicationId.Length % sizeof(char) != 0
        || applicationId[^1] != 0
        || applicationId[^2] != 0)
      {
        throw new UnauthorizedAccessException(
          "The WFP application identity is not a terminated UTF-16 path.");
      }

      var applicationPath = Encoding.Unicode.GetString(
        applicationId,
        0,
        applicationId.Length - sizeof(char));
      if (applicationPath.Contains('\0', StringComparison.Ordinal)
        || !string.Equals(
          applicationPath,
          NormalizedNtPath,
          StringComparison.OrdinalIgnoreCase))
      {
        throw new UnauthorizedAccessException(
          "The WFP application identity does not name the locked executable.");
      }
      RequireStillSame(expectedVolumeSerialNumber, expectedFileId);
    }

    internal void RequireStillSame(
      uint expectedVolumeSerialNumber,
      ulong expectedFileId)
    {
      ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
      var (volumeSerialNumber, fileId) = QueryFileIdentity(_file.SafeFileHandle);
      var normalizedNtPath = QueryNormalizedNtImagePath(_file.SafeFileHandle);
      if (volumeSerialNumber != _volumeSerialNumber
        || fileId != _fileId
        || volumeSerialNumber != expectedVolumeSerialNumber
        || fileId != expectedFileId
        || !string.Equals(
          normalizedNtPath,
          NormalizedNtPath,
          StringComparison.Ordinal))
      {
        throw new UnauthorizedAccessException(
          "The locked executable identity drifted during v3 enrollment.");
      }
    }

    public void Dispose()
    {
      if (Interlocked.Exchange(ref _disposed, 1) == 0)
      {
        CryptographicOperations.ZeroMemory(ImageSha256);
        _file.Dispose();
      }
    }
  }

  private static string QueryNormalizedNtImagePath(SafeFileHandle file)
  {
    var capacity = 32_768;
    var value = new char[capacity];
    var length = GetFinalPathNameByHandle(
      file,
      value,
      checked((uint)capacity),
      VolumeNameNt);
    if (length == 0 || length >= capacity)
    {
      throw new Win32Exception(
        Marshal.GetLastWin32Error(),
        "The executable NT path could not be measured.");
    }
    return new string(value, 0, checked((int)length)).ToUpperInvariant();
  }

  private static (uint VolumeSerialNumber, ulong FileId) QueryFileIdentity(
    SafeFileHandle file)
  {
    if (!GetFileInformationByHandle(file, out var information))
    {
      throw new Win32Exception(
        Marshal.GetLastWin32Error(),
        "The executable file identity could not be measured.");
    }
    var fileId = ((ulong)information.FileIndexHigh << 32)
      | information.FileIndexLow;
    return (information.VolumeSerialNumber, fileId);
  }

  internal static byte[] QueryWfpApplicationId(string path)
  {
    var status = FwpmGetAppIdFromFileName(path, out var value);
    if (status != 0 || value == IntPtr.Zero)
    {
      throw new Win32Exception(
        checked((int)status),
        "The executable WFP application identity could not be measured.");
    }
    try
    {
      var blob = Marshal.PtrToStructure<FwpByteBlob>(value);
      if (blob.Size is < 2 or > NetworkIsolationProtocolV3.MaximumAppIdBytes
        || blob.Data == IntPtr.Zero)
      {
        throw new InvalidDataException("The WFP application identity is malformed.");
      }
      var output = new byte[blob.Size];
      Marshal.Copy(blob.Data, output, 0, checked((int)blob.Size));
      return output;
    }
    finally
    {
      FwpmFreeMemory(ref value);
    }
  }

  private static ulong QueryProcessStartKey(
    SafeProcessHandle process,
    int expectedProcessId)
  {
    var buffer = new byte[4_096];
    try
    {
      var status = NtQueryInformationProcess(
        process,
        ProcessTelemetryIdInformation,
        buffer,
        buffer.Length,
        out var returned);
      if (status < 0 || returned < 24)
      {
        throw new Win32Exception(
          RtlNtStatusToDosError(status),
          "The kernel process start key could not be measured.");
      }
      var processId = BinaryPrimitives.ReadUInt32LittleEndian(buffer.AsSpan(4, 4));
      var startKey = BinaryPrimitives.ReadUInt64LittleEndian(buffer.AsSpan(8, 8));
      if (processId != checked((uint)expectedProcessId) || startKey == 0)
      {
        throw new InvalidDataException(
          "The kernel process telemetry identity is inconsistent.");
      }
      return startKey;
    }
    finally
    {
      CryptographicOperations.ZeroMemory(buffer);
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

  private const uint ProcessTerminate = 0x0001;
  private const uint ProcessSetQuota = 0x0100;
  private const uint ProcessQueryInformation = 0x0400;
  private const uint ProcessQueryLimitedInformation = 0x1000;
  private const uint Synchronize = 0x00100000;
  private const uint VolumeNameNt = 0x00000002;
  private const int ProcessTelemetryIdInformation = 64;
  private const uint JobObjectLimitKillOnJobClose = 0x00002000;
  private const int JobObjectExtendedLimitInformationClass = 9;
  private const uint IsolationFailureExitCode = 0xE0004001;

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern SafeProcessHandle OpenProcess(
    uint desiredAccess,
    [MarshalAs(UnmanagedType.Bool)] bool inheritHandle,
    uint processId);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetProcessTimes(
    SafeProcessHandle process,
    out FileTime creationTime,
    out FileTime exitTime,
    out FileTime kernelTime,
    out FileTime userTime);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool QueryFullProcessImageName(
    SafeProcessHandle process,
    uint flags,
    [Out] char[] executableName,
    ref int size);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern uint GetFinalPathNameByHandle(
    SafeFileHandle file,
    [Out] char[] path,
    uint pathLength,
    uint flags);

  [DllImport(
    "fwpuclnt.dll",
    EntryPoint = "FwpmGetAppIdFromFileName0",
    CharSet = CharSet.Unicode)]
  private static extern uint FwpmGetAppIdFromFileName(
    string fileName,
    out IntPtr appId);

  [DllImport("fwpuclnt.dll", EntryPoint = "FwpmFreeMemory0")]
  private static extern void FwpmFreeMemory(ref IntPtr memory);

  [DllImport("ntdll.dll")]
  private static extern int NtQueryInformationProcess(
    SafeProcessHandle process,
    int processInformationClass,
    [Out] byte[] processInformation,
    int processInformationLength,
    out int returnLength);

  [DllImport("ntdll.dll")]
  private static extern int RtlNtStatusToDosError(int status);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern IntPtr CreateJobObject(
    IntPtr jobAttributes,
    string? name);

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
    SafeProcessHandle process);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool IsProcessInJob(
    SafeProcessHandle process,
    SafeJobHandle job,
    [MarshalAs(UnmanagedType.Bool)] out bool result);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool TerminateJobObject(
    SafeJobHandle job,
    uint exitCode);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetFileInformationByHandle(
    SafeFileHandle file,
    out ByHandleFileInformation information);

  [StructLayout(LayoutKind.Sequential)]
  private struct FileTime
  {
    public uint LowDateTime;
    public uint HighDateTime;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct ByHandleFileInformation
  {
    public uint FileAttributes;
    public FileTime CreationTime;
    public FileTime LastAccessTime;
    public FileTime LastWriteTime;
    public uint VolumeSerialNumber;
    public uint FileSizeHigh;
    public uint FileSizeLow;
    public uint NumberOfLinks;
    public uint FileIndexHigh;
    public uint FileIndexLow;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct FwpByteBlob
  {
    public uint Size;
    public IntPtr Data;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct JobObjectBasicLimitInformation
  {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
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
  private struct JobObjectExtendedLimitInformation
  {
    public JobObjectBasicLimitInformation BasicLimitInformation;
    public IoCounters IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }

  private sealed class SafeJobHandle : SafeHandleZeroOrMinusOneIsInvalid
  {
    public SafeJobHandle(IntPtr handle) : base(ownsHandle: true)
    {
      SetHandle(handle);
    }

    protected override bool ReleaseHandle() => CloseHandle(handle);
  }

  [DllImport("kernel32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool CloseHandle(IntPtr handle);

  private sealed class WindowsPrivilegedCommandProcessLease :
    IPrivilegedCommandProcessLease
  {
    private readonly SafeProcessHandle _process;
    private readonly SafeJobHandle _job;
    private readonly LockedExecutableIdentity _executableIdentity;
    private readonly TimeSpan _operationTimeout;
    private int _disposed;

    public WindowsPrivilegedCommandProcessLease(
      SafeProcessHandle process,
      SafeJobHandle job,
      Guid jobObjectId,
      string jobObjectIdentitySha256,
      NetworkIsolationProcessEnrollmentV3 enrollment,
      LockedExecutableIdentity executableIdentity,
      TimeSpan operationTimeout)
    {
      _process = process;
      _job = job;
      JobObjectId = jobObjectId;
      JobObjectIdentitySha256 = jobObjectIdentitySha256;
      Enrollment = enrollment;
      _executableIdentity = executableIdentity;
      _operationTimeout = operationTimeout;
    }

    public Guid JobObjectId { get; }

    public string JobObjectIdentitySha256 { get; }

    public NetworkIsolationProcessEnrollmentV3 Enrollment { get; }

    public async ValueTask<PrivilegedCommandProcessTerminalFacts> EnsureTerminalAsync(
      bool terminate,
      CancellationToken cancellationToken)
    {
      ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
      if (terminate || !IsJobTerminal(_job))
      {
        if (!TerminateJobObject(_job, IsolationFailureExitCode))
        {
          throw new Win32Exception(
            Marshal.GetLastWin32Error(),
            "The supervisor-owned process tree could not be terminated.");
        }
      }
      using var timeout = CancellationTokenSource.CreateLinkedTokenSource(
        cancellationToken);
      timeout.CancelAfter(_operationTimeout);
      while (!IsJobTerminal(_job))
      {
        await Task.Delay(TimeSpan.FromMilliseconds(25), timeout.Token)
          .ConfigureAwait(false);
      }
      var exitCodeKnown = GetExitCodeProcess(_process, out var exitCode)
        && exitCode != StillActive;
      return new PrivilegedCommandProcessTerminalFacts(
        ProcessTreeTerminal: true,
        exitCodeKnown,
        exitCodeKnown ? unchecked((int)exitCode) : 0,
        DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
    }

    public ValueTask DisposeAsync()
    {
      if (Interlocked.Exchange(ref _disposed, 1) == 0)
      {
        _ = TerminateJobObject(_job, IsolationFailureExitCode);
        _job.Dispose();
        _process.Dispose();
        _executableIdentity.Dispose();
        CryptographicOperations.ZeroMemory(Enrollment.ImageSha256);
        CryptographicOperations.ZeroMemory(Enrollment.ProcessIdentitySha256);
        CryptographicOperations.ZeroMemory(Enrollment.NormalizedAppId);
      }
      return ValueTask.CompletedTask;
    }

    private static bool IsJobTerminal(SafeJobHandle job)
    {
      var information = new JobObjectBasicAccountingInformation();
      if (!QueryInformationJobObject(
        job,
        JobObjectBasicAccountingInformationClass,
        ref information,
        checked((uint)Marshal.SizeOf<JobObjectBasicAccountingInformation>()),
        IntPtr.Zero))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      return information.ActiveProcesses == 0;
    }

    private const uint StillActive = 259;
    private const int JobObjectBasicAccountingInformationClass = 1;

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(
      SafeProcessHandle process,
      out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryInformationJobObject(
      SafeJobHandle job,
      int informationClass,
      ref JobObjectBasicAccountingInformation information,
      uint informationLength,
      IntPtr returnLength);

    [StructLayout(LayoutKind.Sequential)]
    private struct JobObjectBasicAccountingInformation
    {
      public long TotalUserTime;
      public long TotalKernelTime;
      public long ThisPeriodTotalUserTime;
      public long ThisPeriodTotalKernelTime;
      public uint TotalPageFaultCount;
      public uint TotalProcesses;
      public uint ActiveProcesses;
      public uint TotalTerminatedProcesses;
    }
  }
}
