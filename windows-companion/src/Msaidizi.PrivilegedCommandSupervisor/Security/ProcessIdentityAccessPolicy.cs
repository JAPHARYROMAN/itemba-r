using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using Microsoft.Win32.SafeHandles;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;

/// <summary>
/// Replaces every direct Companion-SID process ACE with one exact query and
/// synchronize grant, preserves unrelated trustees, and verifies the applied
/// effective rights. It grants no terminate, VM, token, debug, or control
/// authority.
/// </summary>
public static class ProcessIdentityAccessPolicy
{
  public static void GrantFixedCompanionIdentityRead()
  {
    var serviceSid = new SecurityIdentifier(
      SupervisorServiceIdentity.RequiredCompanionServiceSid);
    if (!ConvertStringSidToSid(serviceSid.Value, out var sid))
    {
      throw new Win32Exception(Marshal.GetLastWin32Error());
    }

    IntPtr securityDescriptor = IntPtr.Zero;
    IntPtr newAcl = IntPtr.Zero;
    IntPtr verificationDescriptor = IntPtr.Zero;
    try
    {
      using var process = new SafeProcessHandle(GetCurrentProcess(), ownsHandle: false);
      var error = GetSecurityInfo(
        process,
        SecurityObjectType.KernelObject,
        DaclSecurityInformation,
        out _,
        out _,
        out var currentAcl,
        out _,
        out securityDescriptor);
      ThrowIfError(error);

      var access = new ExplicitAccess
      {
        AccessPermissions = ExactPeerRights,
        AccessMode = AccessMode.SetAccess,
        Inheritance = 0,
        Trustee = new Trustee
        {
          MultipleTrustee = IntPtr.Zero,
          MultipleTrusteeOperation = 0,
          TrusteeForm = TrusteeForm.Sid,
          TrusteeType = TrusteeType.Unknown,
          Name = sid,
        },
      };
      error = SetEntriesInAcl(1, ref access, currentAcl, out newAcl);
      ThrowIfError(error);
      VerifyExactGrant(newAcl, serviceSid, ref access.Trustee);

      error = SetSecurityInfo(
        process,
        SecurityObjectType.KernelObject,
        DaclSecurityInformation,
        IntPtr.Zero,
        IntPtr.Zero,
        newAcl,
        IntPtr.Zero);
      ThrowIfError(error);

      error = GetSecurityInfo(
        process,
        SecurityObjectType.KernelObject,
        DaclSecurityInformation,
        out _,
        out _,
        out var appliedAcl,
        out _,
        out verificationDescriptor);
      ThrowIfError(error);
      VerifyExactGrant(appliedAcl, serviceSid, ref access.Trustee);
    }
    finally
    {
      if (newAcl != IntPtr.Zero)
      {
        _ = LocalFree(newAcl);
      }
      if (securityDescriptor != IntPtr.Zero)
      {
        _ = LocalFree(securityDescriptor);
      }
      if (verificationDescriptor != IntPtr.Zero)
      {
        _ = LocalFree(verificationDescriptor);
      }
      _ = LocalFree(sid);
    }
  }

  internal static bool IsExactPeerAceSet(
    RawAcl acl,
    SecurityIdentifier serviceSid)
  {
    ArgumentNullException.ThrowIfNull(acl);
    ArgumentNullException.ThrowIfNull(serviceSid);
    CommonAce? match = null;
    for (var index = 0; index < acl.Count; index++)
    {
      var genericAce = acl[index];
      if (genericAce is not KnownAce knownAce
        || knownAce.SecurityIdentifier is null
        || !knownAce.SecurityIdentifier.Equals(serviceSid))
      {
        continue;
      }
      if (match is not null
        || genericAce is not CommonAce commonAce
        || commonAce.AceQualifier != AceQualifier.AccessAllowed
        || commonAce.AceFlags != AceFlags.None
        || commonAce.IsCallback
        || commonAce.AccessMask != unchecked((int)ExactPeerRights))
      {
        return false;
      }
      match = commonAce;
    }
    return match is not null;
  }

  private static void VerifyExactGrant(
    IntPtr acl,
    SecurityIdentifier serviceSid,
    ref Trustee trustee)
  {
    if (acl == IntPtr.Zero)
    {
      throw new UnauthorizedAccessException(
        "The supervisor process-object DACL is unavailable.");
    }
    var aclSize = unchecked((ushort)Marshal.ReadInt16(acl, 2));
    if (aclSize < 8)
    {
      throw new UnauthorizedAccessException(
        "The supervisor process-object DACL is malformed.");
    }
    var bytes = new byte[aclSize];
    Marshal.Copy(acl, bytes, 0, bytes.Length);
    if (!IsExactPeerAceSet(new RawAcl(bytes, 0), serviceSid))
    {
      throw new UnauthorizedAccessException(
        "The Companion process-object ACE is not exact.");
    }

    var error = GetEffectiveRightsFromAcl(acl, ref trustee, out var effectiveRights);
    ThrowIfError(error);
    if (effectiveRights != ExactPeerRights)
    {
      throw new UnauthorizedAccessException(
        "The Companion process-object effective rights are not exact.");
    }
  }

  private static void ThrowIfError(uint error)
  {
    if (error != 0)
    {
      throw new Win32Exception(checked((int)error));
    }
  }

  private const uint ProcessQueryInformation = 0x00000400;
  private const uint Synchronize = 0x00100000;
  private const uint ExactPeerRights =
    ProcessQueryInformation | Synchronize;
  private const uint DaclSecurityInformation = 0x00000004;

  private enum SecurityObjectType
  {
    KernelObject = 6,
  }

  private enum AccessMode
  {
    SetAccess = 2,
  }

  private enum TrusteeForm
  {
    Sid = 0,
  }

  private enum TrusteeType
  {
    Unknown = 0,
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct Trustee
  {
    public IntPtr MultipleTrustee;
    public int MultipleTrusteeOperation;
    public TrusteeForm TrusteeForm;
    public TrusteeType TrusteeType;
    public IntPtr Name;
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct ExplicitAccess
  {
    public uint AccessPermissions;
    public AccessMode AccessMode;
    public uint Inheritance;
    public Trustee Trustee;
  }

  [DllImport("kernel32.dll")]
  private static extern IntPtr GetCurrentProcess();

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool ConvertStringSidToSid(string stringSid, out IntPtr sid);

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern uint GetSecurityInfo(
    SafeHandle handle,
    SecurityObjectType objectType,
    uint securityInformation,
    out IntPtr owner,
    out IntPtr group,
    out IntPtr dacl,
    out IntPtr sacl,
    out IntPtr securityDescriptor);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern uint SetEntriesInAcl(
    uint countOfExplicitEntries,
    ref ExplicitAccess explicitEntry,
    IntPtr oldAcl,
    out IntPtr newAcl);

  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern uint GetEffectiveRightsFromAcl(
    IntPtr acl,
    ref Trustee trustee,
    out uint accessRights);

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern uint SetSecurityInfo(
    SafeHandle handle,
    SecurityObjectType objectType,
    uint securityInformation,
    IntPtr owner,
    IntPtr group,
    IntPtr dacl,
    IntPtr sacl);

  [DllImport("kernel32.dll")]
  private static extern IntPtr LocalFree(IntPtr memory);
}
