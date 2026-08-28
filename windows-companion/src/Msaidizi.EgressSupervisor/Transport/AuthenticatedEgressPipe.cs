using System.ComponentModel;
using System.Collections.Concurrent;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using Itemba.Msaidizi.EgressSupervisor.Security;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.EgressSupervisor.Transport;

public interface IAuthenticatedEgressPipePeer : IDisposable
{
  int ProcessId { get; }

  long ProcessCreationTimeUnixMilliseconds { get; }

  void ThrowIfUnavailable();
}

public interface IEgressPipePeerAuthenticator
{
  IAuthenticatedEgressPipePeer Authenticate(SafePipeHandle pipeHandle);
}

public interface IEgressControlPipeSecurityEvidence
{
  string GetVerifiedSecurityDescriptorSha256();
}

public sealed class WindowsEgressControlPipeSecurityEvidence(
  EgressSupervisorOptions options) : IEgressControlPipeSecurityEvidence
{
  public string GetVerifiedSecurityDescriptorSha256()
  {
    if (!RestrictedEgressPipeFactory.IsSafePipeName(options.PipeName)
      || !string.Equals(
        options.CompanionServiceName,
        EgressSupervisorTrustIdentity.CompanionServiceName,
        StringComparison.Ordinal))
    {
      throw new InvalidOperationException("The egress control-pipe ACL pin is invalid.");
    }
    return RestrictedEgressPipeFactory.SecurityDescriptorSha256(
      options.CompanionServiceName);
  }
}

public static class RestrictedEgressPipeFactory
{
  private static readonly ConcurrentDictionary<string, byte> FirstInstanceClaims =
    new(StringComparer.OrdinalIgnoreCase);

  public static uint RequiredNativePipeMode => PipeRejectRemoteClients;

  public static uint RequiredFirstInstanceOpenMode => FileFlagFirstPipeInstance;

  public static NamedPipeServerStream Create(
    string pipeName,
    string companionServiceName,
    int maximumInstances)
  {
    if (!OperatingSystem.IsWindows()
      || !IsSafePipeName(pipeName)
      || string.IsNullOrWhiteSpace(companionServiceName)
      || maximumInstances is < 1 or > 254)
    {
      throw new InvalidOperationException("The egress named-pipe boundary is invalid.");
    }

    var descriptor = CreateSecurityDescriptor(companionServiceName);
    var descriptorHandle = GCHandle.Alloc(descriptor, GCHandleType.Pinned);
    var firstInstance = FirstInstanceClaims.TryAdd(pipeName, 0);
    try
    {
      var attributes = new SecurityAttributes
      {
        Length = Marshal.SizeOf<SecurityAttributes>(),
        SecurityDescriptor = descriptorHandle.AddrOfPinnedObject(),
        InheritHandle = false,
      };
      var openMode = PipeAccessDuplex
        | FileFlagOverlapped
        | FileFlagWriteThrough
        | (firstInstance ? FileFlagFirstPipeInstance : 0u);
      var handle = CreateNamedPipe(
        $@"\\.\pipe\{pipeName}",
        openMode,
        PipeTypeByte | PipeReadModeByte | PipeWait | PipeRejectRemoteClients,
        checked((uint)maximumInstances),
        16_384,
        16_384,
        0,
        ref attributes);
      if (handle.IsInvalid)
      {
        handle.Dispose();
        if (firstInstance)
        {
          FirstInstanceClaims.TryRemove(pipeName, out _);
        }
        throw new Win32Exception(Marshal.GetLastWin32Error());
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
          FirstInstanceClaims.TryRemove(pipeName, out _);
        }
        throw;
      }
    }
    finally
    {
      descriptorHandle.Free();
      CryptographicOperations.ZeroMemory(descriptor);
    }
  }

  public static bool IsSafePipeName(string value) =>
    !string.IsNullOrWhiteSpace(value)
    && value.Length <= 240
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');

  /// <summary>
  /// Digest of the exact protected ACL authored for every control-pipe handle.
  /// The capability activation attestation binds this value; a different or
  /// inherited ACL therefore cannot produce matching startup evidence.
  /// </summary>
  public static string SecurityDescriptorSha256(string companionServiceName)
  {
    var descriptor = CreateSecurityDescriptor(companionServiceName);
    try
    {
      return Convert.ToHexString(SHA256.HashData(descriptor)).ToLowerInvariant();
    }
    finally
    {
      CryptographicOperations.ZeroMemory(descriptor);
    }
  }

  private static byte[] CreateSecurityDescriptor(string companionServiceName)
  {
    if (!OperatingSystem.IsWindows() || string.IsNullOrWhiteSpace(companionServiceName))
    {
      throw new InvalidOperationException("The egress pipe ACL identity is invalid.");
    }

    var systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
    var companionSid = (SecurityIdentifier)new NTAccount(
      $@"NT SERVICE\{companionServiceName}").Translate(typeof(SecurityIdentifier));
    var security = new PipeSecurity();
    security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
    security.SetOwner(systemSid);
    security.AddAccessRule(new PipeAccessRule(
      systemSid,
      PipeAccessRights.FullControl,
      AccessControlType.Allow));
    security.AddAccessRule(new PipeAccessRule(
      companionSid,
      PipeAccessRights.ReadWrite | PipeAccessRights.Synchronize,
      AccessControlType.Allow));
    return security.GetSecurityDescriptorBinaryForm();
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct SecurityAttributes
  {
    public int Length;
    public IntPtr SecurityDescriptor;
    [MarshalAs(UnmanagedType.Bool)] public bool InheritHandle;
  }

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

  private const uint PipeAccessDuplex = 0x00000003;
  private const uint FileFlagFirstPipeInstance = 0x00080000;
  private const uint FileFlagOverlapped = 0x40000000;
  private const uint FileFlagWriteThrough = 0x80000000;
  private const uint PipeTypeByte = 0x00000000;
  private const uint PipeReadModeByte = 0x00000000;
  private const uint PipeWait = 0x00000000;
  private const uint PipeRejectRemoteClients = 0x00000008;
}

/// <summary>
/// Pins the client to the restricted companion service SID, LocalSystem user,
/// session zero, exact executable path, exact image hash, and live process
/// handle for the entire pipe exchange.
/// </summary>
public sealed class WindowsEgressPipePeerAuthenticator : IEgressPipePeerAuthenticator
{
  private readonly string _expectedImagePath;
  private readonly string _expectedImageSha256;
  private readonly SecurityIdentifier _companionServiceSid;

  public WindowsEgressPipePeerAuthenticator(EgressSupervisorOptions options)
  {
    ArgumentNullException.ThrowIfNull(options);
    if (!OperatingSystem.IsWindows()
      || !IsSafeAbsoluteLocalPath(options.CompanionImagePath)
      || !IsCanonicalSha256(options.CompanionImageSha256))
    {
      throw new InvalidOperationException("The companion pipe-peer pin is invalid.");
    }
    _expectedImagePath = Path.GetFullPath(options.CompanionImagePath);
    _expectedImageSha256 = options.CompanionImageSha256;
    var translatedCompanionSid = (SecurityIdentifier)new NTAccount(
      $@"NT SERVICE\{options.CompanionServiceName}").Translate(
        typeof(SecurityIdentifier));
    _companionServiceSid = new SecurityIdentifier(
      EgressSupervisorTrustIdentity.CompanionServiceSid);
    if (!translatedCompanionSid.Equals(_companionServiceSid))
    {
      throw new InvalidOperationException(
        "The companion restricted service SID does not match its compiled identity.");
    }
  }

  public IAuthenticatedEgressPipePeer Authenticate(SafePipeHandle pipeHandle)
  {
    if (!GetNamedPipeClientProcessId(pipeHandle, out var processId)
      || processId is 0 or > int.MaxValue
      || !ProcessIdToSessionId(processId, out var sessionId)
      || sessionId != 0)
    {
      throw new UnauthorizedAccessException("The egress pipe peer identity is unavailable.");
    }

    var process = OpenProcess(
      ProcessQueryInformation | Synchronize,
      false,
      processId);
    if (process.IsInvalid || WaitForSingleObject(process, 0) != WaitTimeout)
    {
      process.Dispose();
      throw new UnauthorizedAccessException("The egress pipe peer is not live.");
    }

    FileStream? imageLock = null;
    try
    {
      ValidateToken(process);
      var observedPath = QueryProcessImagePath(process);
      if (!string.Equals(observedPath, _expectedImagePath, StringComparison.OrdinalIgnoreCase)
        || HasReparsePoint(_expectedImagePath))
      {
        throw new UnauthorizedAccessException("The egress pipe peer image path is not pinned.");
      }

      imageLock = OpenAndBindMappedImage(process, _expectedImagePath);
      var observedSha256 = Convert.ToHexString(SHA256.HashData(imageLock))
        .ToLowerInvariant();
      if (!FixedTimeHex(observedSha256, _expectedImageSha256))
      {
        throw new UnauthorizedAccessException("The egress pipe peer image is not pinned.");
      }
      imageLock.Position = 0;
      if (!GetProcessTimes(
        process,
        out var creation,
        out _,
        out _,
        out _))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      var creationTime = DateTimeOffset.FromFileTime(creation).ToUnixTimeMilliseconds();
      return new PeerLease(
        checked((int)processId),
        creationTime,
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

  private void ValidateToken(SafeProcessHandle process)
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
      if (identity.User is null
        || !identity.User.Equals(systemSid)
        || identity.Groups is null
        || !identity.Groups.Contains(_companionServiceSid)
        || !RestrictedServiceTokenValidator.IsRestrictedTo(
          token,
          _companionServiceSid))
      {
        throw new UnauthorizedAccessException(
          "The egress pipe peer is not the restricted LocalSystem companion service.");
      }
    }
  }

  private static string QueryProcessImagePath(SafeProcessHandle process)
  {
    var length = 32_768u;
    var buffer = new char[length];
    bool queried;
    unsafe
    {
      fixed (char* pointer = buffer)
      {
        queried = QueryFullProcessImageName(process, 0, pointer, ref length);
      }
    }
    if (!queried || length == 0)
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    return Path.GetFullPath(new string(buffer, 0, checked((int)length)));
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
          "The companion image file identity is unsafe.");
      }

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
          "The companion mapped image does not match the measured file.");
      }

      var finalPath = GetFinalPath(handle);
      if (!string.Equals(
          finalPath,
          Path.GetFullPath(expectedPath),
          StringComparison.OrdinalIgnoreCase))
      {
        throw new UnauthorizedAccessException(
          "The companion image handle resolved to an unexpected path.");
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

  private static bool HasReparsePoint(string path)
  {
    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
    {
      return true;
    }
    var directory = Directory.GetParent(path);
    while (directory is not null)
    {
      if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
      {
        return true;
      }
      directory = directory.Parent;
    }
    return false;
  }

  private static bool IsSafeAbsoluteLocalPath(string value)
  {
    if (string.IsNullOrWhiteSpace(value)
      || !Path.IsPathFullyQualified(value)
      || value.StartsWith("\\\\", StringComparison.Ordinal)
      || value.StartsWith("\\??\\", StringComparison.Ordinal)
      || value.StartsWith("\\\\?\\", StringComparison.Ordinal))
    {
      return false;
    }
    try
    {
      return string.Equals(Path.GetFullPath(value), value, StringComparison.OrdinalIgnoreCase)
        && value.IndexOf(':', 3) < 0;
    }
    catch (Exception exception) when (exception is ArgumentException
      or NotSupportedException
      or PathTooLongException)
    {
      return false;
    }
  }

  private static bool IsCanonicalSha256(string value) => value.Length == 64
    && string.Equals(value, value.ToLowerInvariant(), StringComparison.Ordinal)
    && value.All(Uri.IsHexDigit);

  private static bool FixedTimeHex(string actual, string expected)
  {
    var actualBytes = Convert.FromHexString(actual);
    var expectedBytes = Convert.FromHexString(expected);
    try
    {
      return CryptographicOperations.FixedTimeEquals(actualBytes, expectedBytes);
    }
    finally
    {
      CryptographicOperations.ZeroMemory(actualBytes);
      CryptographicOperations.ZeroMemory(expectedBytes);
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

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
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
    out long creationTime,
    out long exitTime,
    out long kernelTime,
    out long userTime);

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

  private sealed class PeerLease(
    int processId,
    long processCreationTimeUnixMilliseconds,
    SafeProcessHandle process,
    FileStream imageLock) : IAuthenticatedEgressPipePeer
  {
    private int _disposed;

    public int ProcessId { get; } = processId;

    public long ProcessCreationTimeUnixMilliseconds { get; } =
      processCreationTimeUnixMilliseconds;

    public void ThrowIfUnavailable()
    {
      ObjectDisposedException.ThrowIf(Volatile.Read(ref _disposed) != 0, this);
      if (WaitForSingleObject(process, 0) != WaitTimeout)
      {
        throw new EndOfStreamException("The authenticated egress pipe peer exited.");
      }
    }

    public void Dispose()
    {
      if (Interlocked.Exchange(ref _disposed, 1) == 0)
      {
        imageLock.Dispose();
        process.Dispose();
      }
    }
  }
}
