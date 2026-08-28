using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.Companion.Service.Security;

/// <summary>
/// Proves that a local supervisor peer is LocalSystem and that its fixed SCM
/// service SID appears both as an enabled group and in TokenRestrictedSids.
/// An unrestricted LocalSystem process is never an acceptable peer.
/// </summary>
internal static class RestrictedServicePeerTokenValidator
{
  public static bool IsExactRestrictedService(
    SafeAccessTokenHandle token,
    SecurityIdentifier requiredServiceSid)
  {
    ArgumentNullException.ThrowIfNull(token);
    ArgumentNullException.ThrowIfNull(requiredServiceSid);
    if (token.IsInvalid || token.IsClosed || !IsTokenRestricted(token))
    {
      return false;
    }

    using var identity = new WindowsIdentity(token.DangerousGetHandle());
    var localSystem = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
    if (identity.User is null
      || !localSystem.Equals(identity.User)
      || identity.Groups is null
      || !identity.Groups.Contains(requiredServiceSid))
    {
      return false;
    }

    _ = GetTokenInformation(
      token,
      TokenRestrictedSids,
      IntPtr.Zero,
      0,
      out var requiredLength);
    var error = Marshal.GetLastWin32Error();
    if (requiredLength <= 0 || error != ErrorInsufficientBuffer)
    {
      throw new Win32Exception(
        error,
        "The trusted supervisor token restrictions are unavailable.");
    }

    var buffer = Marshal.AllocHGlobal(requiredLength);
    try
    {
      if (!GetTokenInformation(
          token,
          TokenRestrictedSids,
          buffer,
          requiredLength,
          out var returnedLength))
      {
        throw new Win32Exception(
          Marshal.GetLastWin32Error(),
          "The trusted supervisor token restrictions could not be read.");
      }
      if (returnedLength < Marshal.SizeOf<uint>())
      {
        return false;
      }

      var count = checked((uint)Marshal.ReadInt32(buffer));
      if (count is 0 or > MaximumRestrictedSidCount)
      {
        return false;
      }
      var firstOffset = Marshal.OffsetOf<TokenGroupsLayout>(
        nameof(TokenGroupsLayout.First)).ToInt32();
      var itemSize = Marshal.SizeOf<SidAndAttributes>();
      var requiredBytes = checked(firstOffset + checked((int)count) * itemSize);
      if (returnedLength < requiredBytes)
      {
        return false;
      }

      for (var index = 0; index < count; index++)
      {
        var item = Marshal.PtrToStructure<SidAndAttributes>(
          IntPtr.Add(buffer, checked(firstOffset + checked((int)index) * itemSize)));
        if (item.Sid != IntPtr.Zero
          && new SecurityIdentifier(item.Sid).Equals(requiredServiceSid))
        {
          return true;
        }
      }
      return false;
    }
    finally
    {
      Marshal.FreeHGlobal(buffer);
    }
  }

  private const int TokenRestrictedSids = 11;
  private const int ErrorInsufficientBuffer = 122;
  private const uint MaximumRestrictedSidCount = 1_024;

  [StructLayout(LayoutKind.Sequential)]
  private struct SidAndAttributes
  {
    public IntPtr Sid;
    public uint Attributes;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct TokenGroupsLayout
  {
    public uint GroupCount;
    public SidAndAttributes First;
  }

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool IsTokenRestricted(SafeAccessTokenHandle token);

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetTokenInformation(
    SafeAccessTokenHandle token,
    int tokenInformationClass,
    IntPtr tokenInformation,
    int tokenInformationLength,
    out int returnLength);
}
