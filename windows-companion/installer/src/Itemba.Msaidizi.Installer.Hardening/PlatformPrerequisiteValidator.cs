using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Itemba.Msaidizi.Installer.Hardening;

public static partial class PlatformPrerequisiteValidator
{
  private const uint Success = 0;
  private const uint Tpm20 = 2;

  public static void Validate(InstallLayout layout)
  {
    if (!OperatingSystem.IsWindowsVersionAtLeast(10, 0, 22000) ||
        !Environment.Is64BitOperatingSystem ||
        !Environment.Is64BitProcess)
      throw new PlatformNotSupportedException("Windows 11 x64 build 22000 or newer is required.");

    Directory.CreateDirectory(layout.DataRoot);
    InstallLayout.RejectReparsePoints(layout.DataRoot);
    var dataVolume = new DriveInfo(Path.GetPathRoot(layout.DataRoot)!);
    if (!string.Equals(dataVolume.DriveFormat, "NTFS", StringComparison.OrdinalIgnoreCase))
      throw new PlatformNotSupportedException("The ProgramData volume must use NTFS.");

    var info = new TbsDeviceInfo { StructVersion = 1 };
    var result = TbsiGetDeviceInfo((uint)Marshal.SizeOf<TbsDeviceInfo>(), ref info);
    if (result != Success)
      throw new Win32Exception(unchecked((int)result), "TPM device discovery failed.");
    if (info.TpmVersion != Tpm20)
      throw new PlatformNotSupportedException("A TPM 2.0 device is required.");
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct TbsDeviceInfo
  {
    public uint StructVersion;
    public uint TpmVersion;
    public uint TpmInterfaceType;
    public uint TpmImplementationRevision;
  }

  [LibraryImport("tbs.dll", EntryPoint = "Tbsi_GetDeviceInfo")]
  private static partial uint TbsiGetDeviceInfo(uint size, ref TbsDeviceInfo info);
}
