using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.ServiceProcess;
using System.Text;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.EgressSupervisor.Security;

public sealed record EgressHostPosture(
  string DeviceId,
  string SupervisorInstanceId,
  string BootId,
  bool SecureBootEnabled,
  bool HvciEnabled,
  bool DriverActive,
  bool ServiceActive,
  string DriverMeasurementSha256,
  string ServiceMeasurementSha256,
  string? BrowserBrokerBuildSha256,
  IReadOnlyList<string> Features);

public interface IEgressHostPostureProvider
{
  EgressHostPosture GetVerifiedPosture();
}

/// <summary>
/// Live Windows posture probe. Configuration is only a pin: Secure Boot, HVCI,
/// the driver service, driver image, and this service image are independently
/// observed before any attestation can be minted.
/// </summary>
public sealed class WindowsEgressHostPostureProvider : IEgressHostPostureProvider
{
  private const string GlobalVariableGuid = "{8BE4DF61-93CA-11D2-AA0D-00E098032B8C}";
  private readonly EgressSupervisorOptions _options;
  private readonly string _destinationPolicySha256;

  public WindowsEgressHostPostureProvider(
    EgressSupervisorOptions options,
    string destinationPolicySha256)
  {
    _options = options;
    _destinationPolicySha256 = destinationPolicySha256;
  }

  public EgressHostPosture GetVerifiedPosture()
  {
    var options = _options;
    if (!OperatingSystem.IsWindows()
      || !Guid.TryParseExact(options.DeviceId, "D", out _)
      || !Guid.TryParseExact(options.SupervisorInstanceId, "D", out _)
      || !options.SecureBootEnabled
      || !options.HvciEnabled
      || !options.DriverActive
      || !IsSafeServiceName(options.DriverServiceName)
      || !IsSafeAbsoluteLocalPath(options.DriverImagePath)
      || !IsSafeDevicePath(options.DriverDevicePath)
      || options.DriverHealthIoControlCode == 0
      || !IsCanonicalSha256(options.DriverMeasurementSha256)
      || !IsCanonicalSha256(options.ServiceMeasurementSha256)
      || !IsCanonicalSha256(_destinationPolicySha256)
      || !ProbeSecureBoot()
      || !ProbeHvci()
      || !ProbeDriver(options.DriverServiceName, options.DriverImagePath)
      || !ImageMatches(options.DriverImagePath, options.DriverMeasurementSha256)
      || !ProbeDriverEnforcement(
        options.DriverDevicePath,
        options.DriverHealthIoControlCode,
        options.DriverMeasurementSha256,
        _destinationPolicySha256)
      || Environment.ProcessPath is not { } processPath
      || !CurrentProcessImageMatches(
        processPath,
        options.ServiceMeasurementSha256))
    {
      throw new InvalidOperationException(
        "The live egress-supervisor host posture does not match its protected pins.");
    }

    return new EgressHostPosture(
      options.DeviceId,
      options.SupervisorInstanceId,
      ResolveBootId(options.DeviceId),
      SecureBootEnabled: true,
      HvciEnabled: true,
      DriverActive: true,
      ServiceActive: true,
      options.DriverMeasurementSha256,
      options.ServiceMeasurementSha256,
      BrowserBrokerBuildSha256: null,
      EgressBoundaryFeatures.CommandRequired);
  }

  private static bool ProbeSecureBoot()
  {
    var buffer = new byte[1];
    return GetFirmwareEnvironmentVariable("SecureBoot", GlobalVariableGuid, buffer, 1) == 1
      && buffer[0] == 1;
  }

  private static bool ProbeHvci()
  {
    using var key = Registry.LocalMachine.OpenSubKey(
      @"SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity",
      writable: false);
    if (key?.GetValue("Enabled") is not int enabled || enabled != 1)
    {
      return false;
    }

    var information = new SystemCodeIntegrityInformation
    {
      Length = (uint)Marshal.SizeOf<SystemCodeIntegrityInformation>(),
    };
    var status = NtQuerySystemInformation(
      103,
      ref information,
      information.Length,
      out _);
    const uint hvciKernelModeEnabled = 0x400;
    const uint hvciKernelModeAudit = 0x800;
    return status == 0
      && (information.CodeIntegrityOptions & hvciKernelModeEnabled) != 0
      && (information.CodeIntegrityOptions & hvciKernelModeAudit) == 0;
  }

  private static bool ProbeDriver(string serviceName, string expectedImagePath)
  {
    try
    {
      using var service = new ServiceController(serviceName);
      return service.Status == ServiceControllerStatus.Running
        && service.ServiceType.HasFlag(ServiceType.KernelDriver)
        && IsExactLoadedDriver(expectedImagePath);
    }
    catch (InvalidOperationException)
    {
      return false;
    }
  }

  private static bool IsExactLoadedDriver(string expectedImagePath)
  {
    var drivers = new IntPtr[2_048];
    if (!EnumDeviceDrivers(
      drivers,
      checked((uint)(drivers.Length * IntPtr.Size)),
      out var needed)
      || needed > drivers.Length * IntPtr.Size)
    {
      return false;
    }

    var expected = Path.GetFullPath(expectedImagePath);
    var count = checked((int)(needed / IntPtr.Size));
    var buffer = new char[32_768];
    for (var index = 0; index < count; index++)
    {
      int length;
      unsafe
      {
        fixed (char* pointer = buffer)
        {
          length = GetDeviceDriverFileName(
            drivers[index],
            pointer,
            buffer.Length);
        }
      }
      if (length <= 0 || length >= buffer.Length)
      {
        continue;
      }
      var observed = ExpandKernelPath(new string(buffer, 0, length));
      if (observed is not null
        && string.Equals(observed, expected, StringComparison.OrdinalIgnoreCase))
      {
        return true;
      }
    }
    return false;
  }

  private static string? ExpandKernelPath(string value)
  {
    if (value.StartsWith(@"\SystemRoot\", StringComparison.OrdinalIgnoreCase))
    {
      return Path.GetFullPath(Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.Windows),
        value[12..]));
    }
    if (value.StartsWith(@"\??\", StringComparison.Ordinal))
    {
      return Path.GetFullPath(value[4..]);
    }
    return Path.IsPathFullyQualified(value) ? Path.GetFullPath(value) : null;
  }

  private static bool ProbeDriverEnforcement(
    string devicePath,
    uint ioControlCode,
    string driverMeasurementSha256,
    string destinationPolicySha256)
  {
    using var device = CreateFile(
      devicePath,
      0x80000000u | 0x40000000u,
      0,
      IntPtr.Zero,
      3,
      0x80,
      IntPtr.Zero);
    if (device.IsInvalid)
    {
      return false;
    }

    var nonce = RandomNumberGenerator.GetBytes(32);
    var policy = Convert.FromHexString(destinationPolicySha256);
    var request = new byte[64];
    var response = new byte[32];
    try
    {
      Buffer.BlockCopy(nonce, 0, request, 0, nonce.Length);
      Buffer.BlockCopy(policy, 0, request, nonce.Length, policy.Length);
      if (!DeviceIoControl(
        device,
        ioControlCode,
        request,
        request.Length,
        response,
        response.Length,
        out var returned,
        IntPtr.Zero)
        || returned != response.Length)
      {
        return false;
      }

      var domain = Encoding.ASCII.GetBytes("MSAIDIZI-EGRESS-DRIVER-HEALTH-V1\0");
      var measurement = Convert.FromHexString(driverMeasurementSha256);
      try
      {
        var material = new byte[checked(
          domain.Length + nonce.Length + measurement.Length + policy.Length)];
        Buffer.BlockCopy(domain, 0, material, 0, domain.Length);
        Buffer.BlockCopy(nonce, 0, material, domain.Length, nonce.Length);
        Buffer.BlockCopy(measurement, 0, material, domain.Length + nonce.Length,
          measurement.Length);
        Buffer.BlockCopy(
          policy,
          0,
          material,
          domain.Length + nonce.Length + measurement.Length,
          policy.Length);
        try
        {
          var expected = SHA256.HashData(material);
          try
          {
            return CryptographicOperations.FixedTimeEquals(response, expected);
          }
          finally
          {
            CryptographicOperations.ZeroMemory(expected);
          }
        }
        finally
        {
          CryptographicOperations.ZeroMemory(material);
        }
      }
      finally
      {
        CryptographicOperations.ZeroMemory(domain);
        CryptographicOperations.ZeroMemory(measurement);
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(nonce);
      CryptographicOperations.ZeroMemory(policy);
      CryptographicOperations.ZeroMemory(request);
      CryptographicOperations.ZeroMemory(response);
    }
  }

  private static bool ImageMatches(string path, string expectedSha256)
  {
    try
    {
      var fullPath = Path.GetFullPath(path);
      if (!string.Equals(fullPath, path, StringComparison.OrdinalIgnoreCase)
        || HasReparsePoint(fullPath))
      {
        return false;
      }

      using var stream = new FileStream(
        fullPath,
        FileMode.Open,
        FileAccess.Read,
        FileShare.Read,
        16_384,
        FileOptions.SequentialScan);
      var actual = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
      return FixedTimeHex(actual, expectedSha256);
    }
    catch (Exception exception) when (exception is IOException
      or UnauthorizedAccessException
      or NotSupportedException)
    {
      return false;
    }
  }

  /// <summary>
  /// Measures the file object which backs the current process image. A pathname
  /// hash alone is insufficient because an attacker can rename or replace that
  /// pathname after the service image was mapped.
  /// </summary>
  internal static bool CurrentProcessImageMatches(
    string path,
    string expectedSha256)
  {
    try
    {
      var fullPath = Path.GetFullPath(path);
      if (!string.Equals(fullPath, path, StringComparison.OrdinalIgnoreCase)
        || HasReparsePoint(fullPath))
      {
        return false;
      }

      using var process = OpenProcess(
        ProcessQueryInformation | Synchronize,
        inheritHandle: false,
        checked((uint)Environment.ProcessId));
      if (process.IsInvalid)
      {
        return false;
      }

      var observedProcessPath = QueryProcessImagePath(process);
      if (!string.Equals(
          observedProcessPath,
          fullPath,
          StringComparison.OrdinalIgnoreCase))
      {
        return false;
      }

      using var stream = OpenAndBindMappedImage(process, fullPath);
      var actual = Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant();
      return FixedTimeHex(actual, expectedSha256);
    }
    catch (Exception exception) when (exception is IOException
      or UnauthorizedAccessException
      or NotSupportedException
      or Win32Exception)
    {
      return false;
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
          "The egress-supervisor image file identity is unsafe.");
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
          "The egress-supervisor mapped image does not match the measured file.");
      }

      var finalPath = GetFinalPath(handle);
      if (!string.Equals(
          finalPath,
          Path.GetFullPath(expectedPath),
          StringComparison.OrdinalIgnoreCase))
      {
        throw new UnauthorizedAccessException(
          "The egress-supervisor image handle resolved to an unexpected path.");
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

  private static string ResolveBootId(string deviceId)
  {
    var information = new SystemTimeOfDayInformation();
    var status = NtQuerySystemInformation(
      3,
      ref information,
      checked((uint)Marshal.SizeOf<SystemTimeOfDayInformation>()),
      out _);
    if (status != 0 || information.BootTime <= 0)
    {
      throw new InvalidOperationException(
        "The live Windows boot identity is unavailable.");
    }
    var material = Encoding.UTF8.GetBytes(
      $"{deviceId}\n{information.BootTime}");
    try
    {
      var digest = SHA256.HashData(material);
      try
      {
        digest[6] = (byte)((digest[6] & 0x0f) | 0x50);
        digest[8] = (byte)((digest[8] & 0x3f) | 0x80);
        return new Guid(digest.AsSpan(0, 16), bigEndian: true).ToString("D");
      }
      finally
      {
        CryptographicOperations.ZeroMemory(digest);
      }
    }
    finally
    {
      CryptographicOperations.ZeroMemory(material);
    }
  }

  private static bool FixedTimeHex(string actual, string expected)
  {
    try
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
    catch (FormatException)
    {
      return false;
    }
  }

  private static bool IsSafeServiceName(string value) => value.Length is >= 1 and <= 256
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is ' ' or '.' or '-' or '_');

  private static bool IsCanonicalSha256(string value) => value.Length == 64
    && string.Equals(value, value.ToLowerInvariant(), StringComparison.Ordinal)
    && value.All(Uri.IsHexDigit);

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

  private static bool IsSafeDevicePath(string value) =>
    value.StartsWith(@"\\.\", StringComparison.Ordinal)
    && value.Length is >= 5 and <= 260
    && value[4..].All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '-' or '_');

  [StructLayout(LayoutKind.Sequential)]
  private struct SystemCodeIntegrityInformation
  {
    public uint Length;
    public uint CodeIntegrityOptions;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct SystemTimeOfDayInformation
  {
    public long BootTime;
    public long CurrentTime;
    public long TimeZoneBias;
    public uint TimeZoneId;
    public uint Reserved;
    public ulong BootTimeBias;
    public ulong SleepTimeBias;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern uint GetFirmwareEnvironmentVariable(
    string variableName,
    string vendorGuid,
    [Out] byte[] buffer,
    uint size);

  [DllImport("ntdll.dll")]
  private static extern int NtQuerySystemInformation(
    int informationClass,
    ref SystemCodeIntegrityInformation information,
    uint informationLength,
    out uint returnLength);

  [DllImport("ntdll.dll")]
  private static extern int NtQuerySystemInformation(
    int informationClass,
    ref SystemTimeOfDayInformation information,
    uint informationLength,
    out uint returnLength);

  [DllImport("psapi.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool EnumDeviceDrivers(
    [Out] IntPtr[] imageBases,
    uint arraySize,
    out uint needed);

  [DllImport("psapi.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern unsafe int GetDeviceDriverFileName(
    IntPtr imageBase,
    char* fileName,
    int size);

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern SafeFileHandle CreateFile(
    string fileName,
    uint desiredAccess,
    uint shareMode,
    IntPtr securityAttributes,
    uint creationDisposition,
    uint flagsAndAttributes,
    IntPtr templateFile);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern SafeProcessHandle OpenProcess(
    uint desiredAccess,
    [MarshalAs(UnmanagedType.Bool)] bool inheritHandle,
    uint processId);

  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern unsafe bool QueryFullProcessImageName(
    SafeProcessHandle process,
    int flags,
    char* executableName,
    ref uint size);

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

  private const uint ProcessQueryInformation = 0x0400;
  private const uint Synchronize = 0x00100000;
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

  [DllImport("kernel32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool DeviceIoControl(
    SafeFileHandle device,
    uint ioControlCode,
    byte[] inputBuffer,
    int inputBufferSize,
    byte[] outputBuffer,
    int outputBufferSize,
    out int bytesReturned,
    IntPtr overlapped);
}
