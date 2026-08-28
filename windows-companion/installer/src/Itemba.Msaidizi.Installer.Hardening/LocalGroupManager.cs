using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace Itemba.Msaidizi.Installer.Hardening;

public static partial class LocalGroupManager
{
  private const uint Success = 0;
  private const uint ErrorAliasExists = 1379;

  public static SecurityIdentifier EnsureRecoveryOperatorsGroup()
  {
    var name = Marshal.StringToHGlobalUni(InstallerConstants.RecoveryOperatorsGroup);
    var comment = Marshal.StringToHGlobalUni(
      "Human emergency operators authorized to inspect recovery evidence and operate the local kill switch.");
    try
    {
      var group = new LocalGroupInfo1 { Name = name, Comment = comment };
      var status = NetLocalGroupAdd(null, 1, ref group, out _);
      if (status != Success && status != ErrorAliasExists)
        throw new Win32Exception(unchecked((int)status), "Could not create the recovery-operator group.");
    }
    finally
    {
      Marshal.FreeHGlobal(comment);
      Marshal.FreeHGlobal(name);
    }

    var lookup = NetLocalGroupGetInfo(null, InstallerConstants.RecoveryOperatorsGroup, 0, out var buffer);
    if (lookup != Success)
      throw new Win32Exception(unchecked((int)lookup), "The recovery-operator identity is not a local group.");
    if (buffer != IntPtr.Zero)
      _ = NetApiBufferFree(buffer);

    return (SecurityIdentifier)new NTAccount(
      Environment.MachineName,
      InstallerConstants.RecoveryOperatorsGroup).Translate(typeof(SecurityIdentifier));
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct LocalGroupInfo1
  {
    public IntPtr Name;
    public IntPtr Comment;
  }

  [LibraryImport("netapi32.dll", EntryPoint = "NetLocalGroupAdd", StringMarshalling = StringMarshalling.Utf16)]
  private static partial uint NetLocalGroupAdd(
    string? serverName,
    uint level,
    ref LocalGroupInfo1 buffer,
    out uint parameterError);

  [LibraryImport("netapi32.dll", EntryPoint = "NetLocalGroupGetInfo", StringMarshalling = StringMarshalling.Utf16)]
  private static partial uint NetLocalGroupGetInfo(
    string? serverName,
    string groupName,
    uint level,
    out IntPtr buffer);

  [LibraryImport("netapi32.dll", EntryPoint = "NetApiBufferFree")]
  private static partial uint NetApiBufferFree(IntPtr buffer);
}
