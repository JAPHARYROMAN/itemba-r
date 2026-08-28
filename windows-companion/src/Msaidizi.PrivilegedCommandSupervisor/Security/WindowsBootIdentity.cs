using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;

public interface IBootIdentity
{
  string BootId { get; }
}

public sealed class WindowsBootIdentity : IBootIdentity
{
  public WindowsBootIdentity()
  {
    if (!OperatingSystem.IsWindows())
    {
      throw new PlatformNotSupportedException(
        "Privileged-command isolation requires Windows 11.");
    }

    var length = Marshal.SizeOf<SystemBootEnvironmentInformation>();
    var buffer = Marshal.AllocHGlobal(length);
    try
    {
      var status = NtQuerySystemInformation(
        SystemBootEnvironmentInformationClass,
        buffer,
        checked((uint)length),
        out var returned);
      if (status != 0 || returned < length)
      {
        throw new Win32Exception(
          unchecked((int)RtlNtStatusToDosError(status)),
          "The Windows boot identifier is unavailable.");
      }

      var information = Marshal.PtrToStructure<SystemBootEnvironmentInformation>(buffer);
      if (information.BootIdentifier == Guid.Empty)
      {
        throw new InvalidOperationException("Windows returned an empty boot identifier.");
      }
      BootId = information.BootIdentifier.ToString("D");
    }
    finally
    {
      Marshal.FreeHGlobal(buffer);
    }
  }

  public string BootId { get; }

  private const int SystemBootEnvironmentInformationClass = 90;

  [StructLayout(LayoutKind.Sequential)]
  private struct SystemBootEnvironmentInformation
  {
    public Guid BootIdentifier;
    public int FirmwareType;
    public ulong BootFlags;
  }

  [DllImport("ntdll.dll")]
  private static extern int NtQuerySystemInformation(
    int systemInformationClass,
    IntPtr systemInformation,
    uint systemInformationLength,
    out int returnLength);

  [DllImport("ntdll.dll")]
  private static extern uint RtlNtStatusToDosError(int status);
}
