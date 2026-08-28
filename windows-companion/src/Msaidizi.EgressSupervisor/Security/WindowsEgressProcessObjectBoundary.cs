using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

namespace Itemba.Msaidizi.EgressSupervisor.Security;

/// <summary>
/// Gives the pinned companion service only the process-object rights needed to
/// attest this supervisor. It does not grant termination, VM access, token,
/// debug, SCM, or process-control rights.
/// </summary>
public static class WindowsEgressProcessObjectBoundary
{
  internal const int CompanionProcessAccessMask = 0x00100400;
  private const int DaclSecurityInformation = 0x00000004;

  public static void GrantCompanionQueryAccess(EgressSupervisorOptions options)
  {
    ArgumentNullException.ThrowIfNull(options);
    if (!OperatingSystem.IsWindows()
      || string.IsNullOrWhiteSpace(options.CompanionServiceName))
    {
      throw new InvalidOperationException(
        "The egress supervisor process-object peer is invalid.");
    }

    var companionSid = (SecurityIdentifier)new NTAccount(
      "NT SERVICE",
      options.CompanionServiceName).Translate(typeof(SecurityIdentifier));
    var process = GetCurrentProcess();
    var descriptor = ReadDescriptor(process);
    if (descriptor.DiscretionaryAcl is null)
    {
      throw new UnauthorizedAccessException(
        "The egress supervisor process has no discretionary ACL.");
    }

    var restrictedDacl = BuildRestrictedPeerDacl(
      descriptor.DiscretionaryAcl,
      companionSid);
    var replacement = new RawSecurityDescriptor(
      descriptor.ControlFlags
        | ControlFlags.DiscretionaryAclPresent,
      descriptor.Owner,
      descriptor.Group,
      descriptor.SystemAcl,
      restrictedDacl);
    var bytes = new byte[replacement.BinaryLength];
    replacement.GetBinaryForm(bytes, 0);
    try
    {
      if (!SetKernelObjectSecurity(
        process,
        DaclSecurityInformation,
        bytes))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
    }
    finally
    {
      Array.Clear(bytes);
    }

    var observed = ReadDescriptor(process);
    if (observed.DiscretionaryAcl is null
      || !HasExactPeerGrant(observed.DiscretionaryAcl, companionSid))
    {
      throw new UnauthorizedAccessException(
        "The egress supervisor process peer grant was not applied exactly.");
    }
  }

  internal static RawAcl BuildRestrictedPeerDacl(
    RawAcl existing,
    SecurityIdentifier companionSid)
  {
    ArgumentNullException.ThrowIfNull(existing);
    ArgumentNullException.ThrowIfNull(companionSid);
    var result = new RawAcl(existing.Revision, checked(existing.Count + 1));
    var insertionIndex = 0;
    foreach (GenericAce ace in existing)
    {
      if (ace is QualifiedAce qualified
        && qualified.SecurityIdentifier is not null
        && qualified.SecurityIdentifier.Equals(companionSid))
      {
        continue;
      }
      if ((ace.AceFlags & AceFlags.Inherited) == 0)
      {
        result.InsertAce(insertionIndex++, ace);
      }
    }
    result.InsertAce(insertionIndex++, new CommonAce(
      AceFlags.None,
      AceQualifier.AccessAllowed,
      CompanionProcessAccessMask,
      companionSid,
      isCallback: false,
      opaque: null));
    foreach (GenericAce ace in existing)
    {
      if ((ace.AceFlags & AceFlags.Inherited) == 0
        || (ace is QualifiedAce qualified
          && qualified.SecurityIdentifier is not null
          && qualified.SecurityIdentifier.Equals(companionSid)))
      {
        continue;
      }
      result.InsertAce(insertionIndex++, ace);
    }
    return result;
  }

  internal static bool HasExactPeerGrant(
    RawAcl dacl,
    SecurityIdentifier companionSid)
  {
    var matches = 0;
    foreach (GenericAce genericAce in dacl)
    {
      if (genericAce is not QualifiedAce qualified
        || qualified.SecurityIdentifier is null
        || !qualified.SecurityIdentifier.Equals(companionSid))
      {
        continue;
      }
      if (genericAce is not CommonAce common
        || common.AceQualifier != AceQualifier.AccessAllowed
        || common.AceFlags != AceFlags.None
        || common.IsCallback
        || common.AccessMask != CompanionProcessAccessMask)
      {
        return false;
      }
      matches++;
    }
    return matches == 1;
  }

  private static RawSecurityDescriptor ReadDescriptor(IntPtr process)
  {
    _ = GetKernelObjectSecurity(
      process,
      DaclSecurityInformation,
      null,
      0,
      out var required);
    var error = Marshal.GetLastWin32Error();
    if (required == 0 || error != 122)
    {
      throw new Win32Exception(error);
    }

    var bytes = new byte[required];
    try
    {
      if (!GetKernelObjectSecurity(
        process,
        DaclSecurityInformation,
        bytes,
        checked((uint)bytes.Length),
        out _))
      {
        throw new Win32Exception(Marshal.GetLastWin32Error());
      }
      return new RawSecurityDescriptor(bytes, 0);
    }
    finally
    {
      Array.Clear(bytes);
    }
  }

  [DllImport("kernel32.dll")]
  private static extern IntPtr GetCurrentProcess();

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetKernelObjectSecurity(
    IntPtr handle,
    int requestedInformation,
    byte[]? securityDescriptor,
    uint length,
    out uint lengthNeeded);

  [DllImport("advapi32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetKernelObjectSecurity(
    IntPtr handle,
    int securityInformation,
    byte[] securityDescriptor);
}
