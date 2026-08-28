using System.ComponentModel;
using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Channel;

internal static class SecureIsolationPipeFactory
{
  private static readonly ConcurrentDictionary<string, byte> FirstInstanceClaims =
    new(StringComparer.OrdinalIgnoreCase);

  public static uint RequiredNativePipeMode => PipeRejectRemoteClients;

  public static uint RequiredFirstInstanceOpenMode => FileFlagFirstPipeInstance;

  public static NamedPipeServerStream Create(
    PrivilegedCommandSupervisorOptions options)
  {
    var sddl = $"D:P(A;;GA;;;SY)(A;;GA;;;{SupervisorServiceIdentity.RequiredCompanionServiceSid})";
    if (!ConvertStringSecurityDescriptorToSecurityDescriptor(
        sddl,
        1,
        out var descriptor,
        out _))
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    var firstInstance = FirstInstanceClaims.TryAdd(options.PipeName, 0);
    try
    {
      var attributes = new SecurityAttributes
      {
        Length = Marshal.SizeOf<SecurityAttributes>(),
        SecurityDescriptor = descriptor,
        InheritHandle = false,
      };
      var openMode = PipeAccessDuplex
        | FileFlagOverlapped
        | FileFlagWriteThrough
        | (firstInstance ? FileFlagFirstPipeInstance : 0u);
      var handle = CreateNamedPipe(
        $"\\\\.\\pipe\\{options.PipeName}",
        openMode,
        PipeTypeByte | PipeReadModeByte | PipeWait | PipeRejectRemoteClients,
        checked((uint)options.MaximumConcurrentClients),
        checked((uint)options.MaximumFrameBytes + 4u),
        checked((uint)options.MaximumFrameBytes + 4u),
        0,
        ref attributes);
      if (handle.IsInvalid)
      {
        var error = Marshal.GetLastWin32Error();
        handle.Dispose();
        if (firstInstance)
        {
          FirstInstanceClaims.TryRemove(options.PipeName, out _);
        }
        throw new Win32Exception(error, "The isolation pipe could not be created.");
      }

      try
      {
        return new NamedPipeServerStream(
          PipeDirection.InOut,
          isAsync: true,
          isConnected: false,
          handle);
      }
      catch
      {
        handle.Dispose();
        if (firstInstance)
        {
          FirstInstanceClaims.TryRemove(options.PipeName, out _);
        }
        throw;
      }
    }
    finally
    {
      _ = LocalFree(descriptor);
    }
  }

  private const uint PipeAccessDuplex = 0x00000003;
  private const uint FileFlagFirstPipeInstance = 0x00080000;
  private const uint FileFlagWriteThrough = 0x80000000;
  private const uint FileFlagOverlapped = 0x40000000;
  private const uint PipeTypeByte = 0x00000000;
  private const uint PipeReadModeByte = 0x00000000;
  private const uint PipeWait = 0x00000000;
  private const uint PipeRejectRemoteClients = 0x00000008;

  [StructLayout(LayoutKind.Sequential)]
  private struct SecurityAttributes
  {
    public int Length;
    public IntPtr SecurityDescriptor;

    [MarshalAs(UnmanagedType.Bool)]
    public bool InheritHandle;
  }

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool ConvertStringSecurityDescriptorToSecurityDescriptor(
    string stringSecurityDescriptor,
    uint stringSdRevision,
    out IntPtr securityDescriptor,
    out uint securityDescriptorSize);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern SafePipeHandle CreateNamedPipe(
    string name,
    uint openMode,
    uint pipeMode,
    uint maximumInstances,
    uint outputBufferSize,
    uint inputBufferSize,
    uint defaultTimeout,
    ref SecurityAttributes securityAttributes);

  [DllImport("kernel32.dll")]
  private static extern IntPtr LocalFree(IntPtr memory);
}

internal sealed class ValidatedIsolationPipePeer : IDisposable
{
  private readonly SafeProcessHandle _process;
  private readonly FileStream _imageLock;
  private int _disposed;

  private ValidatedIsolationPipePeer(
    PipePeerIdentity identity,
    SafeProcessHandle process,
    FileStream imageLock)
  {
    Identity = identity;
    _process = process;
    _imageLock = imageLock;
  }

  public PipePeerIdentity Identity { get; }

  public static ValidatedIsolationPipePeer Create(
    SafePipeHandle pipe,
    PrivilegedCommandSupervisorOptions options)
  {
    if (!GetNamedPipeClientProcessId(pipe, out var processId)
      || processId is 0 or > int.MaxValue
      || !ProcessIdToSessionId(processId, out var sessionId)
      || sessionId != 0)
    {
      throw new UnauthorizedAccessException(
        "The isolation pipe client is not a session-zero process.");
    }

    var process = OpenProcess(
      ProcessQueryInformation | Synchronize,
      inheritHandle: false,
      processId);
    if (process.IsInvalid || WaitForSingleObject(process, 0) != WaitTimeout)
    {
      process.Dispose();
      throw new UnauthorizedAccessException("The isolation pipe client is not live.");
    }

    FileStream? imageLock = null;
    try
    {
      ValidateProcessToken(
        process,
        SupervisorServiceIdentity.RequiredCompanionServiceSid);
      var observedPath = QueryProcessImagePath(process);
      var expectedPath = Path.GetFullPath(options.ExpectedCompanionImagePath);
      if (!string.Equals(observedPath, expectedPath, StringComparison.OrdinalIgnoreCase))
      {
        throw new UnauthorizedAccessException(
          "The isolation pipe client image path is not pinned.");
      }
      EnsureNoReparsePoints(expectedPath);
      imageLock = OpenAndBindMappedImage(process, expectedPath);
      var imageSha256 = Convert.ToHexString(SHA256.HashData(imageLock))
        .ToLowerInvariant();
      if (!PayloadDigest.FixedTimeEqualsHex(
          imageSha256,
          options.ExpectedCompanionImageSha256))
      {
        throw new UnauthorizedAccessException(
          "The isolation pipe client image measurement is not pinned.");
      }
      imageLock.Position = 0;
      if (!GetProcessTimes(
          process,
          out var created,
          out _,
          out _,
          out _))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      var pathSha256 = Convert.ToHexString(SHA256.HashData(
        Encoding.UTF8.GetBytes(expectedPath.ToUpperInvariant()))).ToLowerInvariant();
      return new ValidatedIsolationPipePeer(
        new PipePeerIdentity(
          checked((int)processId),
          created.ToLong(),
          pathSha256,
          imageSha256),
        process,
        imageLock);
    }
    catch
    {
      imageLock?.Dispose();
      process.Dispose();
      throw;
    }
  }

  private static FileStream OpenAndBindMappedImage(
    SafeProcessHandle process,
    string expectedPath)
  {
    var handle = CreateFile(
      expectedPath,
      GenericRead | FileExecute | Synchronize,
      FileShareRead,
      IntPtr.Zero,
      OpenExisting,
      FileAttributeNormal | FileFlagSequentialScan,
      IntPtr.Zero);
    if (handle.IsInvalid)
    {
      var error = Marshal.GetLastWin32Error();
      handle.Dispose();
      throw new Win32Exception(error);
    }

    try
    {
      if (!GetFileInformationByHandle(handle, out var information)
        || information.NumberOfLinks != 1
        || (information.FileAttributes & FileAttributeReparsePoint) != 0
        || (information.FileAttributes & FileAttributeDirectory) != 0)
      {
        throw new UnauthorizedAccessException(
          "The Companion image file identity is unsafe.");
      }

      // Bind the retained file object to the exact image section mapped into
      // the authenticated Companion process. This rejects path replacement,
      // rename, and hard-link substitution before measurement.
      var fileHandle = handle.DangerousGetHandle();
      var status = NtQueryInformationProcess(
        process,
        ProcessImageFileMapping,
        ref fileHandle,
        IntPtr.Size,
        IntPtr.Zero);
      if (status != NtStatusSuccess)
      {
        throw new UnauthorizedAccessException(
          "The Companion mapped image does not match the measured file.");
      }

      var finalPath = GetFinalPath(handle);
      if (!string.Equals(
          finalPath,
          Path.GetFullPath(expectedPath),
          StringComparison.OrdinalIgnoreCase))
      {
        throw new UnauthorizedAccessException(
          "The Companion image handle resolved to an unexpected path.");
      }
      return new FileStream(handle, FileAccess.Read, 16_384, isAsync: false);
    }
    catch
    {
      handle.Dispose();
      throw;
    }
  }

  private static string GetFinalPath(SafeFileHandle handle)
  {
    var buffer = new char[32_768];
    uint length;
    unsafe
    {
      fixed (char* pointer = buffer)
      {
        length = GetFinalPathNameByHandle(
          handle,
          pointer,
          checked((uint)buffer.Length),
          0);
      }
    }
    if (length == 0 || length >= buffer.Length)
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    var path = new string(buffer, 0, checked((int)length));
    return path.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)
      ? @"\\" + path[8..]
      : path.StartsWith(@"\\?\", StringComparison.Ordinal)
        ? path[4..]
        : path;
  }

  public void ThrowIfUnavailable()
  {
    ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
    if (WaitForSingleObject(_process, 0) != WaitTimeout)
    {
      throw new EndOfStreamException("The authenticated companion process exited.");
    }
  }

  public void Dispose()
  {
    if (Interlocked.Exchange(ref _disposed, 1) == 0)
    {
      _imageLock.Dispose();
      _process.Dispose();
    }
  }

  private static void ValidateProcessToken(
    SafeProcessHandle process,
    string requiredServiceSid)
  {
    if (!OpenProcessToken(
        process.DangerousGetHandle(),
        TokenAccessLevels.Query,
        out var token))
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    using (token)
    using (var identity = new WindowsIdentity(token.DangerousGetHandle()))
    {
      var systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
      var serviceSid = new SecurityIdentifier(requiredServiceSid);
      if (identity.User is null
        || !systemSid.Equals(identity.User)
        || identity.Groups is null
        || !identity.Groups.Contains(serviceSid)
        || !RestrictedServiceTokenValidator.IsRestrictedTo(token, serviceSid))
      {
        throw new UnauthorizedAccessException(
          "The isolation pipe client is not the pinned LocalSystem service SID.");
      }
    }
  }

  private static string QueryProcessImagePath(SafeProcessHandle process)
  {
    var length = 32_768u;
    var buffer = new char[length];
    bool result;
    unsafe
    {
      fixed (char* pointer = buffer)
      {
        result = QueryFullProcessImageName(process, 0, pointer, ref length);
      }
    }
    if (!result || length == 0)
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    return Path.GetFullPath(new string(buffer, 0, checked((int)length)));
  }

  private static void EnsureNoReparsePoints(string path)
  {
    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
    {
      throw new UnauthorizedAccessException("The companion image is a reparse point.");
    }
    for (var directory = Directory.GetParent(path);
      directory is not null;
      directory = directory.Parent)
    {
      if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
      {
        throw new UnauthorizedAccessException(
          "The companion image has a reparse-point ancestor.");
      }
    }
  }

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetNamedPipeClientProcessId(
    SafePipeHandle pipe,
    out uint clientProcessId);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool ProcessIdToSessionId(uint processId, out uint sessionId);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern SafeProcessHandle OpenProcess(
    uint desiredAccess,
    [MarshalAs(UnmanagedType.Bool)] bool inheritHandle,
    uint processId);

  [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode,
    SetLastError = true)]
  private static extern SafeFileHandle CreateFile(
    string fileName,
    uint desiredAccess,
    uint shareMode,
    IntPtr securityAttributes,
    uint creationDisposition,
    uint flagsAndAttributes,
    IntPtr templateFile);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetFileInformationByHandle(
    SafeFileHandle file,
    out ByHandleFileInformation fileInformation);

  [DllImport("kernel32.dll", EntryPoint = "GetFinalPathNameByHandleW",
    CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern unsafe uint GetFinalPathNameByHandle(
    SafeFileHandle file,
    char* filePath,
    uint filePathLength,
    uint flags);

  [DllImport("ntdll.dll")]
  private static extern int NtQueryInformationProcess(
    SafeProcessHandle process,
    int processInformationClass,
    ref IntPtr processInformation,
    int processInformationLength,
    IntPtr returnLength);

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool OpenProcessToken(
    IntPtr processHandle,
    TokenAccessLevels desiredAccess,
    out SafeAccessTokenHandle tokenHandle);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern unsafe bool QueryFullProcessImageName(
    SafeProcessHandle process,
    int flags,
    char* executableName,
    ref uint size);

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetProcessTimes(
    SafeProcessHandle process,
    out FileTime creationTime,
    out FileTime exitTime,
    out FileTime kernelTime,
    out FileTime userTime);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern uint WaitForSingleObject(SafeProcessHandle handle, uint milliseconds);

  private const uint ProcessQueryInformation = 0x0400;
  private const uint Synchronize = 0x00100000;
  private const uint WaitTimeout = 0x00000102;
  private const uint GenericRead = 0x80000000;
  private const uint FileExecute = 0x00000020;
  private const uint FileShareRead = 0x00000001;
  private const uint OpenExisting = 3;
  private const uint FileAttributeDirectory = 0x00000010;
  private const uint FileAttributeNormal = 0x00000080;
  private const uint FileAttributeReparsePoint = 0x00000400;
  private const uint FileFlagSequentialScan = 0x08000000;
  private const int ProcessImageFileMapping = 44;
  private const int NtStatusSuccess = 0;

  [StructLayout(LayoutKind.Sequential)]
  private struct ByHandleFileInformation
  {
    public uint FileAttributes;
    public uint CreationTimeLow;
    public uint CreationTimeHigh;
    public uint LastAccessTimeLow;
    public uint LastAccessTimeHigh;
    public uint LastWriteTimeLow;
    public uint LastWriteTimeHigh;
    public uint VolumeSerialNumber;
    public uint FileSizeHigh;
    public uint FileSizeLow;
    public uint NumberOfLinks;
    public uint FileIndexHigh;
    public uint FileIndexLow;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct FileTime
  {
    public uint LowDateTime;
    public uint HighDateTime;

    public long ToLong() => unchecked((long)(((ulong)HighDateTime << 32) | LowDateTime));
  }
}
