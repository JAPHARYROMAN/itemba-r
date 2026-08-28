using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace Itemba.Msaidizi.Companion.Service.Security;

/// <summary>
/// Grants an exact restricted supervisor service SID only the process-object
/// rights required for reciprocal peer pinning. This does not modify the SCM
/// service DACL and grants no terminate, VM, token, debug, or control rights.
/// </summary>
internal static class TrustedSupervisorProcessAccessGrant
{
  private const uint ProcessQueryInformation = 0x00000400;
  private const uint Synchronize = 0x00100000;
  internal const uint SupervisorProcessAccessMask =
    ProcessQueryInformation | Synchronize;
  private const uint DaclSecurityInformation = 0x00000004;
  private static readonly object Gate = new();
  private static readonly HashSet<string> Applied = new(StringComparer.Ordinal);

  public static void Ensure(string serviceSid)
  {
    if (!OperatingSystem.IsWindows()
      || !IsCanonicalRestrictedServiceSid(serviceSid))
    {
      throw new InvalidOperationException(
        "The trusted supervisor service SID is not canonical.");
    }

    lock (Gate)
    {
      if (Applied.Contains(serviceSid))
      {
        return;
      }
      Apply(new SecurityIdentifier(serviceSid));
      Applied.Add(serviceSid);
    }
  }

  internal static bool IsCanonicalRestrictedServiceSid(string? value)
  {
    if (string.IsNullOrWhiteSpace(value)
      || !value.StartsWith("S-1-5-80-", StringComparison.Ordinal))
    {
      return false;
    }
    try
    {
      var sid = new SecurityIdentifier(value);
      if (!string.Equals(sid.Value, value, StringComparison.Ordinal))
      {
        return false;
      }
      var parts = value.Split('-');
      return parts.Length == 9
        && parts.Skip(4).Any(part => !string.Equals(part, "0", StringComparison.Ordinal));
    }
    catch (ArgumentException)
    {
      return false;
    }
  }

  private static void Apply(SecurityIdentifier serviceSid)
  {
    var sidBytes = new byte[serviceSid.BinaryLength];
    serviceSid.GetBinaryForm(sidBytes, 0);
    var sidPointer = Marshal.AllocHGlobal(sidBytes.Length);
    IntPtr securityDescriptor = IntPtr.Zero;
    IntPtr newAcl = IntPtr.Zero;
    IntPtr verificationDescriptor = IntPtr.Zero;
    try
    {
      Marshal.Copy(sidBytes, 0, sidPointer, sidBytes.Length);
      var handle = GetCurrentProcess();
      var getResult = GetSecurityInfo(
        handle,
        SecurityObjectType.KernelObject,
        DaclSecurityInformation,
        out _,
        out _,
        out var existingAcl,
        out _,
        out securityDescriptor);
      ThrowIfError(getResult, "read the companion process DACL");

      var trustee = new Trustee
      {
        MultipleTrustee = IntPtr.Zero,
        MultipleTrusteeOperation = 0,
        TrusteeForm = TrusteeForm.Sid,
        TrusteeType = TrusteeType.Unknown,
        Name = sidPointer,
      };
      var access = new ExplicitAccess
      {
        AccessPermissions = SupervisorProcessAccessMask,
        AccessMode = AccessMode.SetAccess,
        Inheritance = 0,
        Trustee = trustee,
      };
      var aclResult = SetEntriesInAcl(1, ref access, existingAcl, out newAcl);
      ThrowIfError(aclResult, "construct the companion process DACL");
      VerifyExactRights(newAcl, ref trustee);

      var setResult = SetSecurityInfo(
        handle,
        SecurityObjectType.KernelObject,
        DaclSecurityInformation,
        IntPtr.Zero,
        IntPtr.Zero,
        newAcl,
        IntPtr.Zero);
      ThrowIfError(setResult, "apply the companion process DACL");

      var verifyResult = GetSecurityInfo(
        handle,
        SecurityObjectType.KernelObject,
        DaclSecurityInformation,
        out _,
        out _,
        out var appliedAcl,
        out _,
        out verificationDescriptor);
      ThrowIfError(verifyResult, "reread the companion process DACL");
      VerifyExactRights(appliedAcl, ref trustee);
    }
    finally
    {
      Array.Clear(sidBytes);
      Marshal.FreeHGlobal(sidPointer);
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
    }
  }

  private static void VerifyExactRights(IntPtr acl, ref Trustee trustee)
  {
    var result = GetEffectiveRightsFromAcl(acl, ref trustee, out var effectiveRights);
    ThrowIfError(result, "verify the companion process DACL");
    const uint expected = SupervisorProcessAccessMask;
    if (effectiveRights != expected)
    {
      throw new UnauthorizedAccessException(
        "The trusted supervisor process-object grant is not exact.");
    }
  }

  private static void ThrowIfError(uint error, string operation)
  {
    if (error != 0)
    {
      throw new Win32Exception(
        checked((int)error),
        $"Unable to {operation} for trusted supervisor peer pinning.");
    }
  }

  private enum SecurityObjectType : uint
  {
    KernelObject = 6,
  }

  private enum AccessMode : uint
  {
    SetAccess = 2,
  }

  private enum TrusteeForm : uint
  {
    Sid = 0,
  }

  private enum TrusteeType : uint
  {
    Unknown = 0,
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct Trustee
  {
    public IntPtr MultipleTrustee;
    public uint MultipleTrusteeOperation;
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

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern uint GetSecurityInfo(
    IntPtr handle,
    SecurityObjectType objectType,
    uint securityInformation,
    out IntPtr owner,
    out IntPtr group,
    out IntPtr dacl,
    out IntPtr sacl,
    out IntPtr securityDescriptor);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern uint SetEntriesInAcl(
    uint explicitEntries,
    ref ExplicitAccess explicitAccess,
    IntPtr oldAcl,
    out IntPtr newAcl);

  [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern uint GetEffectiveRightsFromAcl(
    IntPtr acl,
    ref Trustee trustee,
    out uint accessRights);

  [DllImport("advapi32.dll", SetLastError = true)]
  private static extern uint SetSecurityInfo(
    IntPtr handle,
    SecurityObjectType objectType,
    uint securityInformation,
    IntPtr owner,
    IntPtr group,
    IntPtr dacl,
    IntPtr sacl);

  [DllImport("kernel32.dll")]
  private static extern IntPtr LocalFree(IntPtr memory);
}
