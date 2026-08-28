using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;

namespace Itemba.Msaidizi.Installer.Hardening;

[Flags]
public enum ServiceControlRights
{
  QueryConfig = 0x0001,
  ChangeConfig = 0x0002,
  QueryStatus = 0x0004,
  EnumerateDependents = 0x0008,
  Start = 0x0010,
  Stop = 0x0020,
  PauseContinue = 0x0040,
  Interrogate = 0x0080,
  UserDefinedControl = 0x0100,
  ReadControl = 0x00020000,
  FullControl = 0x000F01FF,
  Observe = ReadControl | QueryConfig | QueryStatus | EnumerateDependents | Interrogate,
  Operate = Observe | Start | Stop | PauseContinue | UserDefinedControl,
}

public sealed record ServiceAclGrant(
  InstallerPrincipal Principal,
  ServiceControlRights Rights);

public sealed record ServiceAclDefinition(
  string ServiceName,
  IReadOnlyList<ServiceAclGrant> Grants);

public static class ServiceAclBlueprint
{
  public static IReadOnlyList<ServiceAclDefinition> Services { get; } =
  [
    Definition(
      InstallerConstants.CompanionService,
      new(InstallerPrincipal.System, ServiceControlRights.FullControl),
      new(InstallerPrincipal.Administrators, ServiceControlRights.FullControl),
      new(InstallerPrincipal.CompanionService, ServiceControlRights.Observe),
      new(InstallerPrincipal.UpdateSupervisor, ServiceControlRights.Operate),
      new(InstallerPrincipal.RecoverySupervisor, ServiceControlRights.Operate),
      new(InstallerPrincipal.RecoveryOperators, ServiceControlRights.Operate)),
    Definition(
      InstallerConstants.UpdateSupervisorService,
      new(InstallerPrincipal.System, ServiceControlRights.FullControl),
      new(InstallerPrincipal.Administrators, ServiceControlRights.FullControl),
      new(InstallerPrincipal.UpdateSupervisor, ServiceControlRights.Observe),
      new(InstallerPrincipal.RecoveryOperators, ServiceControlRights.Operate)),
    Definition(
      InstallerConstants.RecoverySupervisorService,
      new(InstallerPrincipal.System, ServiceControlRights.FullControl),
      new(InstallerPrincipal.Administrators, ServiceControlRights.FullControl),
      new(InstallerPrincipal.RecoverySupervisor, ServiceControlRights.Observe),
      new(InstallerPrincipal.RecoveryOperators, ServiceControlRights.Operate)),
    Definition(
      InstallerConstants.AuditSignerService,
      new(InstallerPrincipal.System, ServiceControlRights.FullControl),
      new(InstallerPrincipal.Administrators, ServiceControlRights.FullControl),
      new(InstallerPrincipal.AuditSigner, ServiceControlRights.Observe),
      new(InstallerPrincipal.RecoveryOperators, ServiceControlRights.Operate)),
    Definition(
      InstallerConstants.EgressSupervisorService,
      new(InstallerPrincipal.System, ServiceControlRights.FullControl),
      new(InstallerPrincipal.Administrators, ServiceControlRights.FullControl),
      new(InstallerPrincipal.EgressSupervisor, ServiceControlRights.Observe),
      new(InstallerPrincipal.RecoveryOperators, ServiceControlRights.Operate)),
    Definition(
      InstallerConstants.PrivilegedCommandSupervisorService,
      new(InstallerPrincipal.System, ServiceControlRights.FullControl),
      new(InstallerPrincipal.Administrators, ServiceControlRights.FullControl),
      new(InstallerPrincipal.PrivilegedCommandSupervisor, ServiceControlRights.Observe),
      new(InstallerPrincipal.RecoveryOperators, ServiceControlRights.Operate)),
  ];

  private static ServiceAclDefinition Definition(
    string serviceName,
    params ServiceAclGrant[] grants) => new(serviceName, grants);
}

public static partial class ServiceDaclHardener
{
  private const uint ScManagerConnect = 0x0001;
  private const uint ReadControl = 0x00020000;
  private const uint WriteDac = 0x00040000;
  private const int DaclSecurityInformation = 0x00000004;

  public static void Apply(SecurityIdentifier recoveryOperatorsSid)
  {
    var identities = new Dictionary<InstallerPrincipal, SecurityIdentifier>
    {
      [InstallerPrincipal.System] = new(WellKnownSidType.LocalSystemSid, null),
      [InstallerPrincipal.Administrators] = new(WellKnownSidType.BuiltinAdministratorsSid, null),
      [InstallerPrincipal.CompanionService] = ResolveServiceSid(InstallerConstants.CompanionService),
      [InstallerPrincipal.UpdateSupervisor] = ResolveServiceSid(InstallerConstants.UpdateSupervisorService),
      [InstallerPrincipal.RecoverySupervisor] = ResolveServiceSid(InstallerConstants.RecoverySupervisorService),
      [InstallerPrincipal.AuditSigner] = ResolveServiceSid(InstallerConstants.AuditSignerService),
      [InstallerPrincipal.EgressSupervisor] = ResolveServiceSid(InstallerConstants.EgressSupervisorService),
      [InstallerPrincipal.PrivilegedCommandSupervisor] = ResolveServiceSid(
        InstallerConstants.PrivilegedCommandSupervisorService),
      [InstallerPrincipal.RecoveryOperators] = recoveryOperatorsSid,
    };

    var manager = OpenScManager(null, null, ScManagerConnect);
    if (manager == IntPtr.Zero)
      throw new Win32Exception(Marshal.GetLastWin32Error(), "Could not open the Service Control Manager.");
    try
    {
      foreach (var definition in ServiceAclBlueprint.Services)
      {
        var service = OpenService(manager, definition.ServiceName, ReadControl | WriteDac);
        if (service == IntPtr.Zero)
          throw new Win32Exception(
            Marshal.GetLastWin32Error(),
            $"Could not open the installed service '{definition.ServiceName}' for ACL hardening.");
        try
        {
          var descriptor = BuildDescriptor(definition, identities);
          if (!SetServiceObjectSecurity(service, DaclSecurityInformation, descriptor))
            throw new Win32Exception(
              Marshal.GetLastWin32Error(),
              $"Could not apply the service ACL for '{definition.ServiceName}'.");
        }
        finally
        {
          _ = CloseServiceHandle(service);
        }
      }
    }
    finally
    {
      _ = CloseServiceHandle(manager);
    }
  }

  public static byte[] BuildDescriptorForTest(
    ServiceAclDefinition definition,
    IReadOnlyDictionary<InstallerPrincipal, SecurityIdentifier> identities) =>
    BuildDescriptor(definition, identities);

  private static byte[] BuildDescriptor(
    ServiceAclDefinition definition,
    IReadOnlyDictionary<InstallerPrincipal, SecurityIdentifier> identities)
  {
    var acl = new RawAcl(GenericAcl.AclRevision, definition.Grants.Count);
    foreach (var grant in definition.Grants)
    {
      acl.InsertAce(
        acl.Count,
        new CommonAce(
          AceFlags.None,
          AceQualifier.AccessAllowed,
          (int)grant.Rights,
          identities[grant.Principal],
          isCallback: false,
          opaque: null));
    }

    var system = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
    var descriptor = new RawSecurityDescriptor(
      ControlFlags.DiscretionaryAclPresent | ControlFlags.SelfRelative,
      system,
      system,
      systemAcl: null,
      discretionaryAcl: acl);
    var bytes = new byte[descriptor.BinaryLength];
    descriptor.GetBinaryForm(bytes, 0);
    return bytes;
  }

  private static SecurityIdentifier ResolveServiceSid(string serviceName) =>
    (SecurityIdentifier)new NTAccount("NT SERVICE", serviceName)
      .Translate(typeof(SecurityIdentifier));

  [LibraryImport("advapi32.dll", EntryPoint = "OpenSCManagerW", SetLastError = true,
    StringMarshalling = StringMarshalling.Utf16)]
  private static partial IntPtr OpenScManager(
    string? machineName,
    string? databaseName,
    uint desiredAccess);

  [LibraryImport("advapi32.dll", EntryPoint = "OpenServiceW", SetLastError = true,
    StringMarshalling = StringMarshalling.Utf16)]
  private static partial IntPtr OpenService(
    IntPtr serviceManager,
    string serviceName,
    uint desiredAccess);

  [LibraryImport("advapi32.dll", EntryPoint = "SetServiceObjectSecurity", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool SetServiceObjectSecurity(
    IntPtr service,
    int securityInformation,
    byte[] securityDescriptor);

  [LibraryImport("advapi32.dll", EntryPoint = "CloseServiceHandle")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static partial bool CloseServiceHandle(IntPtr serviceHandle);
}
