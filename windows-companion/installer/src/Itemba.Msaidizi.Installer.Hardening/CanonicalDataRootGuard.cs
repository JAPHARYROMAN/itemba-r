using System.Security;
using System.Security.AccessControl;
using System.Security.Principal;

namespace Itemba.Msaidizi.Installer.Hardening;

internal sealed class CanonicalDataRootGuard : IDisposable
{
  private static readonly SecurityIdentifier SystemSid =
    new(WellKnownSidType.LocalSystemSid, null);
  private static readonly SecurityIdentifier AdministratorsSid =
    new(WellKnownSidType.BuiltinAdministratorsSid, null);

  private readonly LockedInstallerPath _commonData;
  private readonly LockedInstallerPath _dataParent;
  private readonly LockedInstallerPath _dataRoot;

  private CanonicalDataRootGuard(
    LockedInstallerPath commonData,
    LockedInstallerPath dataParent,
    LockedInstallerPath dataRoot,
    bool dataRootWasExactlyProtected)
  {
    _commonData = commonData;
    _dataParent = dataParent;
    _dataRoot = dataRoot;
    DataRootWasExactlyProtected = dataRootWasExactlyProtected;
  }

  public bool DataRootWasExactlyProtected { get; }

  public static CanonicalDataRootGuard AcquireAndHarden(InstallLayout layout)
  {
    LockedInstallerPath? commonData = null;
    LockedInstallerPath? dataParent = null;
    LockedInstallerPath? dataRoot = null;
    try
    {
      commonData = HandleBoundPathSecurity.OpenDirectory(layout.CommonDataRoot);
      ValidateCommonData(commonData, layout.CommonDataRoot);

      var parentSecurity = BuildRootSecurity();
      HandleBoundPathSecurity.CreateDirectoryAtomically(layout.DataParent, parentSecurity);
      dataParent = HandleBoundPathSecurity.OpenDirectory(layout.DataParent);
      ValidateBootstrapDirectory(dataParent, "Itemba ProgramData parent");
      dataParent.SetSecurityDescriptor(parentSecurity);
      VerifyExact(dataParent, parentSecurity, "Itemba ProgramData parent");

      var rootSecurity = BuildRootSecurity();
      HandleBoundPathSecurity.CreateDirectoryAtomically(layout.DataRoot, rootSecurity);
      dataRoot = HandleBoundPathSecurity.OpenDirectory(layout.DataRoot);
      ValidateBootstrapDirectory(dataRoot, "Msaidizi data root");
      var wasExact = HandleBoundPathSecurity.HasExactSecurity(
        dataRoot.ReadSecurityDescriptor(),
        rootSecurity);
      dataRoot.SetSecurityDescriptor(rootSecurity);
      VerifyExact(dataRoot, rootSecurity, "Msaidizi data root");

      return new CanonicalDataRootGuard(
        commonData,
        dataParent,
        dataRoot,
        wasExact);
    }
    catch
    {
      dataRoot?.Dispose();
      dataParent?.Dispose();
      commonData?.Dispose();
      throw;
    }
  }

  public void Dispose()
  {
    _dataRoot.Dispose();
    _dataParent.Dispose();
    _commonData.Dispose();
  }

  private static void ValidateCommonData(LockedInstallerPath path, string expected)
  {
    if (!string.Equals(path.Path, expected, StringComparison.OrdinalIgnoreCase))
      throw new SecurityException("The common application-data handle is not canonical.");

    var descriptor = path.ReadSecurityDescriptor();
    if (!HandleBoundPathSecurity.HasTrustedBootstrapOwner(descriptor)
      || HandleBoundPathSecurity.HasUntrustedDeleteChild(descriptor))
    {
      throw new SecurityException(
        "The canonical common application-data directory has unsafe ownership or DELETE_CHILD authority.");
    }
  }

  private static void ValidateBootstrapDirectory(
    LockedInstallerPath path,
    string description)
  {
    var descriptor = path.ReadSecurityDescriptor();
    if (!HandleBoundPathSecurity.HasTrustedBootstrapOwner(descriptor))
      throw new SecurityException($"The {description} was not created by a trusted installer principal.");
    if (HandleBoundPathSecurity.HasUntrustedMutationAuthority(descriptor))
      throw new SecurityException($"The {description} grants unsafe write/delete/control authority.");
  }

  private static void VerifyExact(
    LockedInstallerPath path,
    DirectorySecurity expected,
    string description)
  {
    if (!HandleBoundPathSecurity.HasExactSecurity(path.ReadSecurityDescriptor(), expected))
      throw new SecurityException($"The {description} did not retain its exact protected DACL.");
  }

  private static DirectorySecurity BuildRootSecurity()
  {
    var security = new DirectorySecurity();
    security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
    security.SetOwner(SystemSid);
    foreach (var sid in new[] { SystemSid, AdministratorsSid })
    {
      security.AddAccessRule(new FileSystemAccessRule(
        sid,
        FileSystemRights.FullControl,
        InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
        PropagationFlags.None,
        AccessControlType.Allow));
    }
    return security;
  }
}
