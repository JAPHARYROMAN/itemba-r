using System.Security.AccessControl;
using System.Security.Principal;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;

namespace Itemba.Msaidizi.PrivilegedCommandSupervisor.State;

/// <summary>
/// Verifies the installer-owned lifecycle root and its two precreated files
/// against the exact restricted-service ACL contract.
/// </summary>
internal sealed class WindowsIsolationJournalProtection
{
  private const string RecoveryOperatorsGroup =
    "Itemba Msaidizi Recovery Operators";
  private readonly DirectorySecurity _expectedDirectory;
  private readonly FileSecurity _expectedFile;

  public WindowsIsolationJournalProtection()
  {
    var systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
    var serviceSid = new SecurityIdentifier(
      SupervisorServiceIdentity.RequiredServiceSid);
    var recoverySid = (SecurityIdentifier)new NTAccount(RecoveryOperatorsGroup)
      .Translate(typeof(SecurityIdentifier));
    _expectedDirectory = BuildDirectorySecurity(systemSid, serviceSid, recoverySid);
    _expectedFile = BuildFileSecurity(systemSid, serviceSid, recoverySid);
  }

  public void ValidatePreOpen(
    string directory,
    string journalPath,
    string lockPath)
  {
    if (!OperatingSystem.IsWindows())
    {
      throw new PlatformNotSupportedException(
        "The protected isolation lifecycle journal requires Windows.");
    }
    if (!Directory.Exists(directory)
      || !File.Exists(journalPath)
      || !File.Exists(lockPath))
    {
      throw new UnauthorizedAccessException(
        "The protected isolation journal and ownership lock must be preprovisioned.");
    }
    var volumeRoot = Path.GetPathRoot(directory);
    if (string.IsNullOrWhiteSpace(volumeRoot)
      || !string.Equals(
        new DriveInfo(volumeRoot).DriveFormat,
        "NTFS",
        StringComparison.OrdinalIgnoreCase))
    {
      throw new UnauthorizedAccessException(
        "The protected isolation lifecycle journal requires NTFS.");
    }
    EnsureNoReparsePoints(directory);
    EnsureNoReparsePoints(journalPath);
    EnsureNoReparsePoints(lockPath);
    RequireExact(
      new DirectoryInfo(directory).GetAccessControl(
        AccessControlSections.Owner | AccessControlSections.Access),
      _expectedDirectory,
      "directory");
    RequireExact(
      new FileInfo(journalPath).GetAccessControl(
        AccessControlSections.Owner | AccessControlSections.Access),
      _expectedFile,
      "journal");
    RequireExact(
      new FileInfo(lockPath).GetAccessControl(
        AccessControlSections.Owner | AccessControlSections.Access),
      _expectedFile,
      "ownership lock");
  }

  public void ValidateOpened(
    string directory,
    string journalPath,
    string lockPath,
    FileStream journal,
    FileStream ownershipLock)
  {
    EnsureNoReparsePoints(directory);
    EnsureNoReparsePoints(journalPath);
    EnsureNoReparsePoints(lockPath);
    RequireExact(journal.GetAccessControl(), _expectedFile, "journal handle");
    RequireExact(
      ownershipLock.GetAccessControl(),
      _expectedFile,
      "ownership lock handle");
    RequireExact(
      new DirectoryInfo(directory).GetAccessControl(
        AccessControlSections.Owner | AccessControlSections.Access),
      _expectedDirectory,
      "directory after open");
  }

  internal static bool HasExactDescriptor(
    RawSecurityDescriptor actual,
    RawSecurityDescriptor expected) =>
    actual.Owner is not null
    && expected.Owner is not null
    && actual.Owner.Equals(expected.Owner)
    && actual.ControlFlags.HasFlag(ControlFlags.DiscretionaryAclProtected)
    && actual.DiscretionaryAcl is not null
    && expected.DiscretionaryAcl is not null
    && string.Equals(
      actual.GetSddlForm(AccessControlSections.Access),
      expected.GetSddlForm(AccessControlSections.Access),
      StringComparison.Ordinal);

  private static DirectorySecurity BuildDirectorySecurity(
    SecurityIdentifier systemSid,
    SecurityIdentifier serviceSid,
    SecurityIdentifier recoverySid)
  {
    var security = new DirectorySecurity();
    security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
    security.SetOwner(systemSid);
    AddDirectoryGrant(security, systemSid, FileSystemRights.FullControl);
    AddDirectoryGrant(security, serviceSid, FileSystemRights.Modify);
    AddDirectoryGrant(security, recoverySid, FileSystemRights.ReadAndExecute);
    return security;
  }

  private static FileSecurity BuildFileSecurity(
    SecurityIdentifier systemSid,
    SecurityIdentifier serviceSid,
    SecurityIdentifier recoverySid)
  {
    var security = new FileSecurity();
    security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
    security.SetOwner(systemSid);
    security.AddAccessRule(new FileSystemAccessRule(
      systemSid,
      FileSystemRights.FullControl,
      AccessControlType.Allow));
    security.AddAccessRule(new FileSystemAccessRule(
      serviceSid,
      FileSystemRights.Modify,
      AccessControlType.Allow));
    security.AddAccessRule(new FileSystemAccessRule(
      recoverySid,
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
    if (!HasExactDescriptor(actualRaw, expectedRaw))
    {
      throw new UnauthorizedAccessException(
        $"The protected isolation {description} has unexpected ACL state.");
    }
  }

  private static void EnsureNoReparsePoints(string path)
  {
    if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
    {
      throw new UnauthorizedAccessException(
        "The protected isolation journal path is a reparse point.");
    }
    for (var directory = Directory.GetParent(path);
      directory is not null;
      directory = directory.Parent)
    {
      if ((directory.Attributes & FileAttributes.ReparsePoint) != 0)
      {
        throw new UnauthorizedAccessException(
          "The protected isolation journal has a reparse-point ancestor.");
      }
    }
  }
}
