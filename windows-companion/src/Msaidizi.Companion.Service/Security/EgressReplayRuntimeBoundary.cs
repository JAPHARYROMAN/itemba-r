using System.Security.AccessControl;
using System.Security.Principal;

namespace Itemba.Msaidizi.Companion.Service.Security;

/// <summary>
/// Runtime verification of the installer-owned egress replay ACL. The service
/// rechecks exact owner and DACL state before opening either mutable file, so a
/// syntactically safe but redirected or re-permissioned path cannot become a
/// replay authority.
/// </summary>
internal static class EgressReplayRuntimeBoundary
{
  private const string CompanionServiceName = "Itemba Msaidizi Companion";
  private const string RecoveryOperatorsGroup = "Itemba Msaidizi Recovery Operators";
  private static readonly SecurityIdentifier SystemSid = new(
    WellKnownSidType.LocalSystemSid,
    null);

  public static void ValidateExactInstallerAcl(
    string directory,
    string ledgerPath,
    string lockPath)
  {
    if (!OperatingSystem.IsWindows())
    {
      throw new PlatformNotSupportedException(
        "The installer-owned egress replay boundary requires Windows.");
    }

    var serviceSid = Resolve(new NTAccount("NT SERVICE", CompanionServiceName));
    var recoveryOperatorsSid = Resolve(new NTAccount(RecoveryOperatorsGroup));
    var expectedDirectory = BuildDirectorySecurity(serviceSid, recoveryOperatorsSid);
    var expectedFile = BuildFileSecurity(serviceSid, recoveryOperatorsSid);
    RequireExact(
      new DirectoryInfo(directory).GetAccessControl(
        AccessControlSections.Owner | AccessControlSections.Access),
      expectedDirectory,
      "directory");
    RequireExact(
      new FileInfo(ledgerPath).GetAccessControl(
        AccessControlSections.Owner | AccessControlSections.Access),
      expectedFile,
      "ledger");
    RequireExact(
      new FileInfo(lockPath).GetAccessControl(
        AccessControlSections.Owner | AccessControlSections.Access),
      expectedFile,
      "ownership lock");
  }

  private static DirectorySecurity BuildDirectorySecurity(
    SecurityIdentifier serviceSid,
    SecurityIdentifier recoveryOperatorsSid)
  {
    var security = new DirectorySecurity();
    security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
    security.SetOwner(SystemSid);
    AddDirectoryGrant(security, SystemSid, FileSystemRights.FullControl);
    AddDirectoryGrant(security, serviceSid, FileSystemRights.Modify);
    AddDirectoryGrant(security, recoveryOperatorsSid, FileSystemRights.ReadAndExecute);
    return security;
  }

  private static FileSecurity BuildFileSecurity(
    SecurityIdentifier serviceSid,
    SecurityIdentifier recoveryOperatorsSid)
  {
    var security = new FileSecurity();
    security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
    security.SetOwner(SystemSid);
    security.AddAccessRule(new FileSystemAccessRule(
      SystemSid,
      FileSystemRights.FullControl,
      AccessControlType.Allow));
    security.AddAccessRule(new FileSystemAccessRule(
      serviceSid,
      FileSystemRights.Modify,
      AccessControlType.Allow));
    security.AddAccessRule(new FileSystemAccessRule(
      recoveryOperatorsSid,
      FileSystemRights.ReadAndExecute,
      AccessControlType.Allow));
    return security;
  }

  private static void AddDirectoryGrant(
    DirectorySecurity security,
    SecurityIdentifier sid,
    FileSystemRights rights) => security.AddAccessRule(new FileSystemAccessRule(
      sid,
      rights,
      InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
      PropagationFlags.None,
      AccessControlType.Allow));

  private static void RequireExact(
    FileSystemSecurity actual,
    ObjectSecurity expected,
    string description)
  {
    var actualRaw = new RawSecurityDescriptor(
      actual.GetSecurityDescriptorBinaryForm(),
      0);
    var expectedRaw = new RawSecurityDescriptor(
      expected.GetSecurityDescriptorBinaryForm(),
      0);
    if (actualRaw.Owner is null
      || expectedRaw.Owner is null
      || !actualRaw.Owner.Equals(expectedRaw.Owner)
      || !actualRaw.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclProtected)
      || actualRaw.DiscretionaryAcl is null
      || expectedRaw.DiscretionaryAcl is null
      || !string.Equals(
        actualRaw.GetSddlForm(AccessControlSections.Access),
        expectedRaw.GetSddlForm(AccessControlSections.Access),
        StringComparison.Ordinal))
    {
      throw new UnauthorizedAccessException(
        $"The installer-owned egress replay {description} has unexpected ACL state.");
    }
  }

  private static SecurityIdentifier Resolve(NTAccount account) =>
    (SecurityIdentifier)account.Translate(typeof(SecurityIdentifier));
}
