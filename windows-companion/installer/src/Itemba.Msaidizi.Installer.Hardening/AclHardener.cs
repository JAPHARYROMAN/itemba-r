using System.Security;
using System.Security.AccessControl;
using System.Security.Principal;

namespace Itemba.Msaidizi.Installer.Hardening;

public enum InstallerPrincipal
{
  System,
  Administrators,
  Users,
  CompanionService,
  UpdateSupervisor,
  RecoverySupervisor,
  AuditSigner,
  EgressSupervisor,
  PrivilegedCommandSupervisor,
  RecoveryOperators,
}

public sealed record AclGrant(
  InstallerPrincipal Principal,
  FileSystemRights Rights,
  bool InheritToChildren = true);

public sealed record DataAclDefinition(
  string RelativePath,
  IReadOnlyList<AclGrant> Grants);

public sealed record ProtectedFileAclDefinition(
  string RelativePath,
  IReadOnlyList<AclGrant> Grants);

public static class AclBlueprint
{
  private const FileSystemRights Read = FileSystemRights.ReadAndExecute;
  private const FileSystemRights Change = FileSystemRights.Modify;
  private const FileSystemRights Full = FileSystemRights.FullControl;

  public static IReadOnlyList<AclGrant> BinaryRootGrants { get; } =
  [
    new(InstallerPrincipal.System, Full),
    new(InstallerPrincipal.Administrators, Full),
    new(InstallerPrincipal.Users, Read),
    new(InstallerPrincipal.CompanionService, Read),
    new(InstallerPrincipal.UpdateSupervisor, Read),
    new(InstallerPrincipal.RecoverySupervisor, Read),
    new(InstallerPrincipal.AuditSigner, Read),
    new(InstallerPrincipal.EgressSupervisor, Read),
    new(InstallerPrincipal.PrivilegedCommandSupervisor, Read),
  ];

  public static IReadOnlyList<DataAclDefinition> DataDirectories { get; } =
  [
    Definition(".",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.Administrators, Full)),
    Definition("config",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.Administrators, Full),
      new(InstallerPrincipal.Users, Read, false),
      new(InstallerPrincipal.CompanionService, Read, false),
      new(InstallerPrincipal.UpdateSupervisor, Read, false),
      new(InstallerPrincipal.RecoverySupervisor, Read, false),
      new(InstallerPrincipal.AuditSigner, Read, false),
      new(InstallerPrincipal.EgressSupervisor, Read, false),
      new(InstallerPrincipal.PrivilegedCommandSupervisor, Read, false)),
    Definition(@"config\service",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.Administrators, Full),
      new(InstallerPrincipal.CompanionService, Read)),
    Definition(@"config\agent",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.Administrators, Full),
      new(InstallerPrincipal.Users, Read)),
    Definition(@"config\update",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.Administrators, Full),
      new(InstallerPrincipal.UpdateSupervisor, Read)),
    Definition(@"config\recovery",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.Administrators, Full),
      new(InstallerPrincipal.RecoverySupervisor, Read)),
    Definition(@"config\audit-signer",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.Administrators, Full),
      new(InstallerPrincipal.AuditSigner, Read)),
    Definition(@"config\egress-supervisor",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.Administrators, Full),
      new(InstallerPrincipal.EgressSupervisor, Read)),
    Definition(@"config\privileged-command-supervisor",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.Administrators, Full),
      new(InstallerPrincipal.PrivilegedCommandSupervisor, Read)),
    Definition("journal",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.Administrators, Read),
      new(InstallerPrincipal.CompanionService, Change),
      new(InstallerPrincipal.RecoveryOperators, Read)),
    Definition("quarantine",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.Administrators, Full),
      new(InstallerPrincipal.CompanionService, Change),
      new(InstallerPrincipal.RecoverySupervisor, Change)),
    Definition("packages",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.Administrators, Full),
      new(InstallerPrincipal.CompanionService, Read)),
    Definition("application-versions",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.UpdateSupervisor, Change),
      new(InstallerPrincipal.CompanionService, Read)),
    Definition("application-state",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.UpdateSupervisor, Change),
      new(InstallerPrincipal.CompanionService, Read)),
    Definition("supervisor",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.CompanionService, Read, false),
      new(InstallerPrincipal.UpdateSupervisor, Read, false),
      new(InstallerPrincipal.RecoverySupervisor, Read, false),
      new(InstallerPrincipal.AuditSigner, Read, false),
      new(InstallerPrincipal.EgressSupervisor, Read, false),
      new(InstallerPrincipal.PrivilegedCommandSupervisor, Read, false),
      new(InstallerPrincipal.RecoveryOperators,
        FileSystemRights.ReadAndExecute |
        FileSystemRights.CreateFiles |
        FileSystemRights.WriteAttributes |
        FileSystemRights.WriteExtendedAttributes,
        false)),
    Definition(@"supervisor\result-cache",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.CompanionService, Change),
      new(InstallerPrincipal.RecoveryOperators, Read)),
    Definition(@"supervisor\egress-boundary",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.CompanionService, Change),
      new(InstallerPrincipal.RecoveryOperators, Read)),
    Definition(@"supervisor\privileged-command-isolation",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.CompanionService, Change),
      new(InstallerPrincipal.RecoveryOperators, Read)),
    Definition(@"supervisor\identity",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.CompanionService, Change),
      new(InstallerPrincipal.UpdateSupervisor, Read),
      new(InstallerPrincipal.RecoverySupervisor, Read)),
    Definition(@"supervisor\update",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.UpdateSupervisor, Change)),
    Definition(@"supervisor\recovery",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.RecoverySupervisor, Change),
      new(InstallerPrincipal.RecoveryOperators, Read)),
    Definition(@"supervisor\audit-signer",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.AuditSigner, Change),
      new(InstallerPrincipal.RecoveryOperators, Read)),
    Definition(@"supervisor\egress-supervisor",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.EgressSupervisor, Change),
      new(InstallerPrincipal.RecoveryOperators, Read)),
    Definition(@"supervisor\privileged-command-supervisor",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.PrivilegedCommandSupervisor, Change),
      new(InstallerPrincipal.RecoveryOperators, Read)),
    Definition(@"supervisor\recovery-vault",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.CompanionService, Change),
      new(InstallerPrincipal.RecoverySupervisor, Change),
      new(InstallerPrincipal.RecoveryOperators, Read)),
    Definition(@"supervisor\secret-vault",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.CompanionService, Change),
      new(InstallerPrincipal.EgressSupervisor, Read)),
    Definition(@"supervisor\secret-provisioning",
      new(InstallerPrincipal.System, Full),
      new(InstallerPrincipal.CompanionService, Change),
      new(InstallerPrincipal.RecoveryOperators, Read)),
  ];

  public static IReadOnlyList<AclGrant> KillSwitchGrants { get; } =
  [
    new(InstallerPrincipal.System, Full),
    new(InstallerPrincipal.CompanionService, FileSystemRights.Read),
    new(InstallerPrincipal.UpdateSupervisor, FileSystemRights.Read),
    new(InstallerPrincipal.RecoverySupervisor, FileSystemRights.Read),
    new(InstallerPrincipal.AuditSigner, FileSystemRights.Read),
    new(InstallerPrincipal.EgressSupervisor, FileSystemRights.Read),
    new(InstallerPrincipal.PrivilegedCommandSupervisor, FileSystemRights.Read),
    new(InstallerPrincipal.RecoveryOperators, Change),
  ];

  public static IReadOnlyList<AclGrant> ProvenanceMarkerGrants { get; } =
  [
    new(InstallerPrincipal.System, Full),
    new(InstallerPrincipal.Administrators, Read),
  ];

  public static IReadOnlyList<ProtectedFileAclDefinition> TrustedMutableFiles { get; } =
  [
    new(
      @"supervisor\egress-boundary\receipts.v1.jsonl",
      DirectoryGrants(@"supervisor\egress-boundary")),
    new(
      @"supervisor\egress-boundary\receipts.v1.jsonl.lock",
      DirectoryGrants(@"supervisor\egress-boundary")),
    new(
      @"supervisor\privileged-command-isolation\replay.v1.jsonl",
      DirectoryGrants(@"supervisor\privileged-command-isolation")),
    new(
      @"supervisor\privileged-command-isolation\replay.v1.jsonl.lock",
      DirectoryGrants(@"supervisor\privileged-command-isolation")),
    new(
      @"supervisor\egress-supervisor\lifecycle.v2.jsonl",
      DirectoryGrants(@"supervisor\egress-supervisor")),
    new(
      @"supervisor\egress-supervisor\lifecycle.v2.jsonl.lock",
      DirectoryGrants(@"supervisor\egress-supervisor")),
    new(
      @"supervisor\privileged-command-supervisor\lifecycle.v1.jsonl",
      DirectoryGrants(@"supervisor\privileged-command-supervisor")),
    new(
      @"supervisor\privileged-command-supervisor\lifecycle.v1.jsonl.lock",
      DirectoryGrants(@"supervisor\privileged-command-supervisor")),
  ];

  private static DataAclDefinition Definition(string path, params AclGrant[] grants) =>
    new(path, grants);

  private static IReadOnlyList<AclGrant> DirectoryGrants(string path) =>
    DataDirectories.Single(definition => string.Equals(
      definition.RelativePath,
      path,
      StringComparison.Ordinal)).Grants;
}

public sealed class AclHardener(InstallLayout layout, SecurityIdentifier recoveryOperatorsSid)
{
  private static readonly SecurityIdentifier SystemSid =
    new(WellKnownSidType.LocalSystemSid, null);
  private static readonly SecurityIdentifier AdministratorsSid =
    new(WellKnownSidType.BuiltinAdministratorsSid, null);
  private static readonly SecurityIdentifier UsersSid =
    new(WellKnownSidType.BuiltinUsersSid, null);

  private readonly IReadOnlyDictionary<InstallerPrincipal, SecurityIdentifier> _identities =
    new Dictionary<InstallerPrincipal, SecurityIdentifier>
    {
      [InstallerPrincipal.System] = SystemSid,
      [InstallerPrincipal.Administrators] = AdministratorsSid,
      [InstallerPrincipal.Users] = UsersSid,
      [InstallerPrincipal.CompanionService] = ResolveServiceSid(InstallerConstants.CompanionService),
      [InstallerPrincipal.UpdateSupervisor] = ResolveServiceSid(InstallerConstants.UpdateSupervisorService),
      [InstallerPrincipal.RecoverySupervisor] = ResolveServiceSid(InstallerConstants.RecoverySupervisorService),
      [InstallerPrincipal.AuditSigner] = ResolveServiceSid(InstallerConstants.AuditSignerService),
      [InstallerPrincipal.EgressSupervisor] = ResolveServiceSid(InstallerConstants.EgressSupervisorService),
      [InstallerPrincipal.PrivilegedCommandSupervisor] = ResolveServiceSid(
        InstallerConstants.PrivilegedCommandSupervisorService),
      [InstallerPrincipal.RecoveryOperators] = recoveryOperatorsSid,
    };

  private ConfigurationTrustMode? _configurationTrustMode;
  private bool _applied;

  public void Apply()
  {
    using var dataGuard = CanonicalDataRootGuard.AcquireAndHarden(layout);
    ValidateBinaryPayload();
    ApplyDirectory(layout.BinaryRoot, AclBlueprint.BinaryRootGrants);

    var trustMode = DetermineConfigurationTrustMode(dataGuard);
    foreach (var definition in AclBlueprint.DataDirectories)
    {
      var path = definition.RelativePath == "."
        ? layout.DataRoot
        : ResolveRelativeDataPath(definition.RelativePath);
      ApplyDirectory(path, definition.Grants, trustMode);
    }

    if (trustMode == ConfigurationTrustMode.FirstInstall)
    {
      ConfigurationProvenance.ValidateFirstInstallInventory(
        layout,
        AclBlueprint.DataDirectories.Select(definition => definition.RelativePath));
    }

    ValidateAndProtectConfigurationFiles(trustMode);
    CreateAndProtectTrustedMutableFiles(trustMode);
    CreateAndProtectKillSwitch(trustMode);
    _configurationTrustMode = trustMode;
    _applied = true;
  }

  public void CommitConfigurationProvenance()
  {
    if (!_applied || _configurationTrustMode is null)
      throw new InvalidOperationException("Installer ACL hardening must succeed before provenance commit.");

    using var dataGuard = CanonicalDataRootGuard.AcquireAndHarden(layout);
    var markerPath = ConfigurationProvenance.MarkerPath(layout);
    if (_configurationTrustMode == ConfigurationTrustMode.TrustedMarkedInstall)
    {
      ValidateProtectedMarker(markerPath);
      return;
    }

    using (var stream = new FileStream(
      markerPath,
      FileMode.CreateNew,
      FileAccess.Write,
      FileShare.Read,
      4096,
      FileOptions.WriteThrough))
    {
      stream.Write(ConfigurationProvenance.MarkerBytes);
      stream.Flush(flushToDisk: true);
    }
    ApplyFile(markerPath, AclBlueprint.ProvenanceMarkerGrants);
    ValidateProtectedMarker(markerPath);
  }

  private void ValidateBinaryPayload()
  {
    InstallLayout.RejectReparsePoints(layout.BinaryRoot);
    foreach (var relative in InstallerConstants.Executables.Values)
    {
      var segments = relative.Split(Path.DirectorySeparatorChar);
      var path = layout.PathInBinaryRoot(segments);
      if (!File.Exists(path))
        throw new FileNotFoundException("A required signed installer payload is missing.", path);
      InstallLayout.RejectReparsePoints(path);
    }

    foreach (var entry in Directory.EnumerateFileSystemEntries(
      layout.BinaryRoot,
      "*",
      new EnumerationOptions
      {
        RecurseSubdirectories = true,
        IgnoreInaccessible = false,
        AttributesToSkip = 0,
        ReturnSpecialDirectories = false,
      }))
    {
      if ((File.GetAttributes(entry) & FileAttributes.ReparsePoint) != 0)
        throw new SecurityException($"Installer payload reparse points are forbidden: {entry}");
    }
  }

  private string ResolveRelativeDataPath(string relative)
  {
    var segments = relative.Split(Path.DirectorySeparatorChar);
    return layout.PathInDataRoot(segments);
  }

  private ConfigurationTrustMode DetermineConfigurationTrustMode(
    CanonicalDataRootGuard dataGuard)
  {
    var marker = ConfigurationProvenance.MarkerPath(layout);
    if (File.Exists(marker))
      return ConfigurationTrustMode.TrustedMarkedInstall;

    if (!dataGuard.DataRootWasExactlyProtected)
      return ConfigurationTrustMode.FirstInstall;

    var definitions = ConfigurationDirectoryDefinitions();
    foreach (var name in ConfigurationProvenance.ConfigurationNames)
    {
      var relative = "config" + Path.DirectorySeparatorChar + name;
      var config = ConfigurationProvenance.ConfigurationPath(layout, name);
      if (!File.Exists(config)
        || !HasExactFileSecurity(config, definitions[relative].Grants))
      {
        return ConfigurationTrustMode.FirstInstall;
      }
    }
    return ConfigurationTrustMode.TrustedLegacyInstall;
  }

  private void ValidateAndProtectConfigurationFiles(ConfigurationTrustMode trustMode)
  {
    if (trustMode == ConfigurationTrustMode.TrustedMarkedInstall)
      ValidateProtectedMarker(ConfigurationProvenance.MarkerPath(layout));

    var definitions = ConfigurationDirectoryDefinitions();
    foreach (var name in ConfigurationProvenance.ConfigurationNames)
    {
      var relative = "config" + Path.DirectorySeparatorChar + name;
      var config = ConfigurationProvenance.ConfigurationPath(layout, name);
      if (!File.Exists(config))
        throw new FileNotFoundException("A preserved safe configuration file is missing.", config);

      using var locked = HandleBoundPathSecurity.OpenSingleLinkFile(config);
      ValidateBootstrapOwner(locked, "configuration file");
      var expectedSecurity = BuildFileSecurity(definitions[relative].Grants);
      var wasExactlyProtected = HandleBoundPathSecurity.HasExactSecurity(
        locked.ReadSecurityDescriptor(),
        expectedSecurity);
      var requirePackagedSafeContent = trustMode == ConfigurationTrustMode.FirstInstall
        || !wasExactlyProtected;
      ConfigurationProvenance.ValidateConfiguration(
        name,
        locked.ReadAllBytes(ConfigurationProvenance.MaximumConfigurationBytes),
        requirePackagedSafeContent);
      locked.SetSecurityDescriptor(expectedSecurity);
      VerifyExactSecurity(locked, expectedSecurity, "configuration file");
    }
  }

  private void CreateAndProtectTrustedMutableFiles(ConfigurationTrustMode trustMode)
  {
    foreach (var definition in AclBlueprint.TrustedMutableFiles)
    {
      var path = ResolveRelativeDataPath(definition.RelativePath);
      var existed = File.Exists(path);
      if (!existed)
      {
        using var stream = new FileStream(
          path,
          FileMode.CreateNew,
          FileAccess.ReadWrite,
          FileShare.Read,
          4096,
          FileOptions.WriteThrough);
        stream.Flush(flushToDisk: true);
      }

      using var locked = HandleBoundPathSecurity.OpenSingleLinkFile(path);
      var expected = BuildFileSecurity(definition.Grants);
      if (existed)
      {
        ValidateBootstrapOwner(locked, "trusted mutable file");
        var actual = locked.ReadSecurityDescriptor();
        var exact = HandleBoundPathSecurity.HasExactSecurity(actual, expected);
        var safeLegacy = trustMode == ConfigurationTrustMode.TrustedLegacyInstall
          && HasOnlyAllowlistedAccess(actual, definition.Grants);
        if (!exact && !safeLegacy)
        {
          throw new SecurityException(
            "A preserved trusted mutable file has unexpected owner or DACL provenance.");
        }
      }
      locked.SetSecurityDescriptor(expected);
      VerifyExactSecurity(locked, expected, "trusted mutable file");
    }
  }

  private void CreateAndProtectKillSwitch(ConfigurationTrustMode trustMode)
  {
    var killSwitch = layout.PathInDataRoot("supervisor", "DISABLED");
    var existed = File.Exists(killSwitch);
    using (var stream = new FileStream(
      killSwitch,
      FileMode.OpenOrCreate,
      FileAccess.ReadWrite,
      FileShare.Read,
      4096,
      FileOptions.WriteThrough))
    {
      if (stream.Length == 0)
      {
        using var writer = new StreamWriter(stream, leaveOpen: true);
        writer.WriteLine("DISABLED BY INSTALLER; EXPLICIT HUMAN PROVISIONING REQUIRED.");
        writer.Flush();
        stream.Flush(flushToDisk: true);
      }
    }
    using var locked = HandleBoundPathSecurity.OpenSingleLinkFile(killSwitch);
    var expected = BuildFileSecurity(AclBlueprint.KillSwitchGrants);
    if (existed)
    {
      ValidateBootstrapOwner(locked, "kill switch");
      var actual = locked.ReadSecurityDescriptor();
      var exact = HandleBoundPathSecurity.HasExactSecurity(actual, expected);
      var safeLegacy = trustMode == ConfigurationTrustMode.TrustedLegacyInstall
        && HasOnlyAllowlistedAccess(actual, AclBlueprint.KillSwitchGrants);
      if (!exact && !safeLegacy)
        throw new SecurityException("The preserved kill switch has unexpected DACL provenance.");
    }
    locked.SetSecurityDescriptor(expected);
    VerifyExactSecurity(locked, expected, "kill switch");
  }

  private void ApplyDirectory(
    string path,
    IReadOnlyList<AclGrant> grants,
    ConfigurationTrustMode? trustMode = null)
  {
    var security = BuildDirectorySecurity(grants);
    var existed = Directory.Exists(path);
    if (!existed)
      Directory.CreateDirectory(path);
    using var locked = HandleBoundPathSecurity.OpenDirectory(path);
    ValidateBootstrapOwner(locked, "installer directory");
    if (existed)
    {
      var actual = locked.ReadSecurityDescriptor();
      var exact = HandleBoundPathSecurity.HasExactSecurity(actual, security);
      var acceptable = trustMode switch
      {
        ConfigurationTrustMode.TrustedMarkedInstall => exact,
        ConfigurationTrustMode.TrustedLegacyInstall => exact
          || HasOnlyAllowlistedAccess(actual, grants),
        _ => !HandleBoundPathSecurity.HasUntrustedMutationAuthority(actual),
      };
      if (!acceptable)
      {
        throw new SecurityException(
          "A pre-existing installer directory has unsafe or unproven write authority.");
      }
    }
    locked.SetSecurityDescriptor(security);
    VerifyExactSecurity(locked, security, "installer directory");
  }

  private void ApplyFile(string path, IReadOnlyList<AclGrant> grants)
  {
    using var locked = HandleBoundPathSecurity.OpenSingleLinkFile(path);
    ValidateBootstrapOwner(locked, "installer file");
    var security = BuildFileSecurity(grants);
    locked.SetSecurityDescriptor(security);
    VerifyExactSecurity(locked, security, "installer file");
  }

  private DirectorySecurity BuildDirectorySecurity(IReadOnlyList<AclGrant> grants)
  {
    var security = new DirectorySecurity();
    security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
    security.SetOwner(SystemSid);
    foreach (var grant in grants)
    {
      var inheritance = grant.InheritToChildren
        ? InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit
        : InheritanceFlags.None;
      security.AddAccessRule(new FileSystemAccessRule(
        _identities[grant.Principal],
        grant.Rights,
        inheritance,
        PropagationFlags.None,
        AccessControlType.Allow));
    }
    return security;
  }

  private FileSecurity BuildFileSecurity(IReadOnlyList<AclGrant> grants)
  {
    var security = new FileSecurity();
    security.SetAccessRuleProtection(isProtected: true, preserveInheritance: false);
    security.SetOwner(SystemSid);
    foreach (var grant in grants)
    {
      security.AddAccessRule(new FileSystemAccessRule(
        _identities[grant.Principal],
        grant.Rights,
        AccessControlType.Allow));
    }
    return security;
  }

  private bool HasExactFileSecurity(string path, IReadOnlyList<AclGrant> grants)
  {
    try
    {
      using var locked = HandleBoundPathSecurity.OpenSingleLinkFile(path);
      return HandleBoundPathSecurity.HasExactSecurity(
        locked.ReadSecurityDescriptor(),
        BuildFileSecurity(grants));
    }
    catch (Exception error) when (error is IOException
      or UnauthorizedAccessException
      or SecurityException)
    {
      return false;
    }
  }

  private bool HasOnlyAllowlistedAccess(
    RawSecurityDescriptor descriptor,
    IReadOnlyList<AclGrant> grants)
  {
    if (descriptor.Owner is null
      || !descriptor.Owner.Equals(SystemSid)
      || descriptor.DiscretionaryAcl is null)
      return false;

    var allowed = grants.ToDictionary(
      grant => _identities[grant.Principal].Value,
      grant => (int)grant.Rights,
      StringComparer.Ordinal);
    foreach (var ace in descriptor.DiscretionaryAcl.OfType<CommonAce>())
    {
      if (ace.AceQualifier != AceQualifier.AccessAllowed
        || !allowed.TryGetValue(ace.SecurityIdentifier.Value, out var maximum)
        || (ace.AccessMask & ~maximum) != 0)
      {
        return false;
      }
    }
    return true;
  }

  private void ValidateProtectedMarker(string markerPath)
  {
    using var locked = HandleBoundPathSecurity.OpenSingleLinkFile(markerPath);
    var expected = BuildFileSecurity(AclBlueprint.ProvenanceMarkerGrants);
    if (!HandleBoundPathSecurity.HasExactSecurity(locked.ReadSecurityDescriptor(), expected))
      throw new SecurityException("The installer-provenance marker has unexpected owner or DACL state.");
    ConfigurationProvenance.ValidateMarker(
      locked.ReadAllBytes(ConfigurationProvenance.MaximumConfigurationBytes));
  }

  private static void ValidateBootstrapOwner(
    LockedInstallerPath locked,
    string description)
  {
    if (!HandleBoundPathSecurity.HasTrustedBootstrapOwner(locked.ReadSecurityDescriptor()))
      throw new SecurityException($"A pre-existing {description} has untrusted ownership.");
  }

  private static void VerifyExactSecurity(
    LockedInstallerPath locked,
    ObjectSecurity expected,
    string description)
  {
    if (!HandleBoundPathSecurity.HasExactSecurity(locked.ReadSecurityDescriptor(), expected))
      throw new SecurityException($"The {description} did not retain its exact protected DACL.");
  }

  private static Dictionary<string, DataAclDefinition>
    ConfigurationDirectoryDefinitions() => AclBlueprint.DataDirectories
      .Where(definition => definition.RelativePath.StartsWith(
        "config" + Path.DirectorySeparatorChar,
        StringComparison.Ordinal))
      .ToDictionary(definition => definition.RelativePath, StringComparer.Ordinal);

  private static SecurityIdentifier ResolveServiceSid(string serviceName) =>
    (SecurityIdentifier)new NTAccount("NT SERVICE", serviceName)
      .Translate(typeof(SecurityIdentifier));
}
