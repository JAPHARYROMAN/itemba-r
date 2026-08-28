using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.ServiceProcess;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;
using Microsoft.Win32;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;

public sealed record WindowsIsolationHostPosture(
  string DriverImagePathSha256,
  bool SecureBootEnabled,
  bool HvciEnabled,
  bool WdacEnforced);

/// <summary>
/// Live, non-configurable Windows posture checks used in addition to the
/// driver's signed response. The fixed SCM kernel-driver service must point to
/// the pinned image and that same image must appear in the loaded-driver list.
/// </summary>
public static class WindowsIsolationHostPostureVerifier
{
  private const string GlobalVariableGuid = "{8BE4DF61-93CA-11D2-AA0D-00E098032B8C}";

  public static WindowsIsolationHostPosture GetVerified(
    PrivilegedCommandSupervisorOptions options)
  {
    ArgumentNullException.ThrowIfNull(options);
    if (!OperatingSystem.IsWindows()
      || !string.Equals(
        options.DriverServiceName,
        PrivilegedCommandIsolationSupervisorIdentity.DriverServiceName,
        StringComparison.Ordinal)
      || !ProbeDriverService(options.DriverServiceName, options.DriverImagePath)
      || !ProbeSecureBoot()
      || !TryGetCodeIntegrity(out var codeIntegrity)
      || !HvciEnforced(codeIntegrity)
      || !WdacEnforced(codeIntegrity))
    {
      throw new UnauthorizedAccessException(
        "The live Windows isolation-driver identity or security posture is unavailable.");
    }

    return new WindowsIsolationHostPosture(
      PayloadDigest.Sha256Hex(Path.GetFullPath(options.DriverImagePath)),
      SecureBootEnabled: true,
      HvciEnabled: true,
      WdacEnforced: true);
  }

  private static bool ProbeDriverService(string serviceName, string expectedImagePath)
  {
    try
    {
      using var service = new ServiceController(serviceName);
      if (service.Status != ServiceControllerStatus.Running
        || !service.ServiceType.HasFlag(ServiceType.KernelDriver))
      {
        return false;
      }
      using var key = Registry.LocalMachine.OpenSubKey(
        $@"SYSTEM\CurrentControlSet\Services\{serviceName}",
        writable: false);
      var configured = key?.GetValue("ImagePath", null, RegistryValueOptions.DoNotExpandEnvironmentNames)
        as string;
      var configuredPath = ExpandKernelPath(configured);
      var expected = Path.GetFullPath(expectedImagePath);
      return configuredPath is not null
        && string.Equals(configuredPath, expected, StringComparison.OrdinalIgnoreCase)
        && IsExactLoadedDriver(expected);
    }
    catch (Exception exception) when (exception is InvalidOperationException
      or UnauthorizedAccessException
      or IOException
      or ArgumentException)
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
    var buffer = new char[32_768];
    var count = checked((int)(needed / IntPtr.Size));
    for (var index = 0; index < count; index++)
    {
      int length;
      unsafe
      {
        fixed (char* pointer = buffer)
        {
          length = GetDeviceDriverFileName(drivers[index], pointer, buffer.Length);
        }
      }
      if (length <= 0 || length >= buffer.Length)
      {
        continue;
      }
      var observed = ExpandKernelPath(new string(buffer, 0, length));
      if (observed is not null
        && string.Equals(
          observed,
          expectedImagePath,
          StringComparison.OrdinalIgnoreCase))
      {
        return true;
      }
    }
    return false;
  }

  private static string? ExpandKernelPath(string? value)
  {
    if (string.IsNullOrWhiteSpace(value)
      || value.Contains('"')
      || value.Contains('\0'))
    {
      return null;
    }
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

  private static bool ProbeSecureBoot()
  {
    var buffer = new byte[1];
    return GetFirmwareEnvironmentVariable(
        "SecureBoot",
        GlobalVariableGuid,
        buffer,
        checked((uint)buffer.Length)) == 1
      && buffer[0] == 1;
  }

  private static bool TryGetCodeIntegrity(out uint options)
  {
    var information = new SystemCodeIntegrityInformation
    {
      Length = checked((uint)Marshal.SizeOf<SystemCodeIntegrityInformation>()),
    };
    var status = NtQuerySystemInformation(
      103,
      ref information,
      information.Length,
      out _);
    options = information.CodeIntegrityOptions;
    return status == 0;
  }

  private static bool HvciEnforced(uint options)
  {
    const uint enabled = 0x400;
    const uint audit = 0x800;
    using var key = Registry.LocalMachine.OpenSubKey(
      @"SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity",
      writable: false);
    return key?.GetValue("Enabled") is int configured
      && configured == 1
      && (options & enabled) != 0
      && (options & audit) == 0;
  }

  private static bool WdacEnforced(uint options)
  {
    const uint codeIntegrityEnabled = 0x1;
    const uint testSigningEnabled = 0x2;
    const uint umciEnabled = 0x4;
    const uint umciAuditMode = 0x8;
    const uint debugModeEnabled = 0x80;
    return (options & codeIntegrityEnabled) != 0
      && (options & umciEnabled) != 0
      && (options & (testSigningEnabled | umciAuditMode | debugModeEnabled)) == 0;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct SystemCodeIntegrityInformation
  {
    public uint Length;
    public uint CodeIntegrityOptions;
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
}
