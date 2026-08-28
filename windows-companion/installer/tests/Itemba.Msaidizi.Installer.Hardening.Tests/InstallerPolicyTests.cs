using System.Security;
using System.Security.AccessControl;
using System.Security.Principal;

namespace Itemba.Msaidizi.Installer.Hardening.Tests;

public sealed class InstallerPolicyTests
{
  private static readonly string BinaryRoot = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
    "Itemba",
    "Msaidizi Companion");
  private static readonly string DataRoot = Path.Combine(
    Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
    "Itemba",
    "Msaidizi");

  [Fact]
  public void ExactCanonicalRootsAreAccepted()
  {
    var layout = InstallLayout.ValidateForInstall(BinaryRoot, DataRoot);

    Assert.Equal(Path.GetFullPath(BinaryRoot), layout.BinaryRoot, ignoreCase: true);
    Assert.Equal(Path.GetFullPath(DataRoot), layout.DataRoot, ignoreCase: true);
  }

  [Theory]
  [InlineData(@"C:\Program Files\Itemba")]
  [InlineData(@"C:\Program Files\Itemba\Msaidizi Companion\..")]
  [InlineData(@"\\server\share\Msaidizi Companion")]
  [InlineData(@"\\?\C:\Program Files\Itemba\Msaidizi Companion")]
  public void NonExactBinaryRootsAreRejected(string path)
  {
    Assert.Throws<SecurityException>(() => InstallLayout.ValidateBinaryRoot(path));
  }

  [Fact]
  public void InstallerCommandHasNoBroadOrDestructiveMode()
  {
    var install = InstallerCommand.Parse(
      ["install", "--binary-root", BinaryRoot, "--data-root", DataRoot]);
    var uninstall = InstallerCommand.Parse(
      ["remove-firewall", "--binary-root", BinaryRoot]);

    Assert.Equal(InstallerOperation.Install, install.Operation);
    Assert.Equal(InstallerOperation.RemoveFirewall, uninstall.Operation);
    Assert.Throws<ArgumentException>(() => InstallerCommand.Parse(["uninstall", "--binary-root", BinaryRoot]));
    Assert.Throws<ArgumentException>(() => InstallerCommand.Parse(
      ["remove-firewall", "--binary-root", BinaryRoot, "--data-root", DataRoot]));
  }

  [Fact]
  public void RecoveryAndSecretVaultsRemainSeparated()
  {
    var recovery = DirectoryDefinition(@"supervisor\recovery-vault");
    var secret = DirectoryDefinition(@"supervisor\secret-vault");

    Assert.Contains(recovery.Grants, grant => grant.Principal == InstallerPrincipal.RecoverySupervisor);
    Assert.DoesNotContain(secret.Grants, grant => grant.Principal == InstallerPrincipal.RecoverySupervisor);
    Assert.DoesNotContain(secret.Grants, grant => grant.Principal == InstallerPrincipal.RecoveryOperators);
    Assert.Contains(secret.Grants, grant =>
      grant.Principal == InstallerPrincipal.CompanionService
      && grant.Rights.HasFlag(FileSystemRights.Modify));
    Assert.Contains(secret.Grants, grant =>
      grant.Principal == InstallerPrincipal.EgressSupervisor
      && grant.Rights.HasFlag(FileSystemRights.ReadAndExecute)
      && !grant.Rights.HasFlag(FileSystemRights.Write));
  }

  [Fact]
  public void ProvisioningAuditIsCompanionWritableButContainsNoSecretVaultAuthority()
  {
    var audit = DirectoryDefinition(@"supervisor\secret-provisioning");
    var secret = DirectoryDefinition(@"supervisor\secret-vault");

    Assert.Contains(audit.Grants, grant =>
      grant.Principal == InstallerPrincipal.CompanionService
      && grant.Rights.HasFlag(FileSystemRights.Modify));
    Assert.Contains(audit.Grants, grant =>
      grant.Principal == InstallerPrincipal.RecoveryOperators
      && !grant.Rights.HasFlag(FileSystemRights.Write));
    Assert.DoesNotContain(secret.Grants, grant =>
      grant.Principal == InstallerPrincipal.RecoveryOperators);
  }

  [Fact]
  public void PrivilegedCommandReplayLedgerHasDedicatedLeastPrivilegeRoot()
  {
    var replay = DirectoryDefinition(@"supervisor\privileged-command-isolation");

    Assert.Contains(replay.Grants, grant =>
      grant.Principal == InstallerPrincipal.System
      && grant.Rights.HasFlag(FileSystemRights.FullControl));
    Assert.Contains(replay.Grants, grant =>
      grant.Principal == InstallerPrincipal.CompanionService
      && grant.Rights.HasFlag(FileSystemRights.Modify));
    Assert.Contains(replay.Grants, grant =>
      grant.Principal == InstallerPrincipal.RecoveryOperators
      && !grant.Rights.HasFlag(FileSystemRights.Write));
    Assert.DoesNotContain(replay.Grants, grant => grant.Principal is
      InstallerPrincipal.Administrators
      or InstallerPrincipal.Users
      or InstallerPrincipal.UpdateSupervisor
      or InstallerPrincipal.RecoverySupervisor
      or InstallerPrincipal.AuditSigner);
  }

  [Fact]
  public void EgressReceiptReplayLedgerHasDedicatedLeastPrivilegeRoot()
  {
    var replay = DirectoryDefinition(@"supervisor\egress-boundary");

    Assert.Contains(replay.Grants, grant =>
      grant.Principal == InstallerPrincipal.System
      && grant.Rights.HasFlag(FileSystemRights.FullControl));
    Assert.Contains(replay.Grants, grant =>
      grant.Principal == InstallerPrincipal.CompanionService
      && grant.Rights.HasFlag(FileSystemRights.Modify));
    Assert.Contains(replay.Grants, grant =>
      grant.Principal == InstallerPrincipal.RecoveryOperators
      && !grant.Rights.HasFlag(FileSystemRights.Write));
    Assert.DoesNotContain(replay.Grants, grant => grant.Principal is
      InstallerPrincipal.Administrators
      or InstallerPrincipal.Users
      or InstallerPrincipal.UpdateSupervisor
      or InstallerPrincipal.RecoverySupervisor
      or InstallerPrincipal.AuditSigner);
    Assert.Contains(AclBlueprint.TrustedMutableFiles, definition =>
      definition.RelativePath == @"supervisor\egress-boundary\receipts.v1.jsonl");
    Assert.Contains(AclBlueprint.TrustedMutableFiles, definition =>
      definition.RelativePath == @"supervisor\egress-boundary\receipts.v1.jsonl.lock");
  }

  [Fact]
  public void OrdinaryUsersCannotWriteBinariesOrTrustedState()
  {
    var userBinary = Assert.Single(
      AclBlueprint.BinaryRootGrants.Where(grant => grant.Principal == InstallerPrincipal.Users));
    Assert.False(userBinary.Rights.HasFlag(FileSystemRights.Write));
    Assert.False(userBinary.Rights.HasFlag(FileSystemRights.Modify));
    Assert.DoesNotContain(
      AclBlueprint.KillSwitchGrants,
      grant => grant.Principal == InstallerPrincipal.Users);
    Assert.DoesNotContain(
      DirectoryDefinition("supervisor").Grants,
      grant => grant.Principal == InstallerPrincipal.Administrators);
  }

  [Fact]
  public void CompanionCannotControlAnySupervisorService()
  {
    var update = ServiceDefinition(InstallerConstants.UpdateSupervisorService);
    var recovery = ServiceDefinition(InstallerConstants.RecoverySupervisorService);
    var auditSigner = ServiceDefinition(InstallerConstants.AuditSignerService);
    var egress = ServiceDefinition(InstallerConstants.EgressSupervisorService);
    var privilegedCommand = ServiceDefinition(
      InstallerConstants.PrivilegedCommandSupervisorService);

    Assert.DoesNotContain(update.Grants, grant => grant.Principal == InstallerPrincipal.CompanionService);
    Assert.DoesNotContain(recovery.Grants, grant => grant.Principal == InstallerPrincipal.CompanionService);
    Assert.DoesNotContain(auditSigner.Grants,
      grant => grant.Principal == InstallerPrincipal.CompanionService);
    Assert.DoesNotContain(egress.Grants,
      grant => grant.Principal == InstallerPrincipal.CompanionService);
    Assert.DoesNotContain(privilegedCommand.Grants,
      grant => grant.Principal == InstallerPrincipal.CompanionService);
    Assert.Contains(update.Grants, grant =>
      grant.Principal == InstallerPrincipal.RecoveryOperators &&
      grant.Rights.HasFlag(ServiceControlRights.Stop));
    Assert.Contains(recovery.Grants, grant =>
      grant.Principal == InstallerPrincipal.RecoveryOperators &&
      grant.Rights.HasFlag(ServiceControlRights.Stop));
    Assert.Contains(auditSigner.Grants, grant =>
      grant.Principal == InstallerPrincipal.RecoveryOperators &&
      grant.Rights.HasFlag(ServiceControlRights.Stop));
    Assert.Contains(egress.Grants, grant =>
      grant.Principal == InstallerPrincipal.RecoveryOperators &&
      grant.Rights.HasFlag(ServiceControlRights.Stop));
    Assert.Contains(privilegedCommand.Grants, grant =>
      grant.Principal == InstallerPrincipal.RecoveryOperators &&
      grant.Rights.HasFlag(ServiceControlRights.Stop));
  }

  [Fact]
  public void TrustedMsaidiziServicesNeverGrantChangeConfiguration()
  {
    foreach (var definition in ServiceAclBlueprint.Services)
    {
      Assert.All(
        definition.Grants.Where(grant => grant.Principal is not (
          InstallerPrincipal.System or InstallerPrincipal.Administrators)),
        grant => Assert.False(
          grant.Rights.HasFlag(ServiceControlRights.ChangeConfig),
          $"{definition.ServiceName} grants SERVICE_CHANGE_CONFIG to "
            + $"{grant.Principal}."));
    }
  }

  [Fact]
  public void AuditSignerCanWriteOnlyItsOwnJournalAndReadTheKillSwitch()
  {
    var signerState = DirectoryDefinition(@"supervisor\audit-signer");

    Assert.Contains(signerState.Grants, grant =>
      grant.Principal == InstallerPrincipal.AuditSigner &&
      grant.Rights.HasFlag(FileSystemRights.Modify));
    Assert.Contains(AclBlueprint.KillSwitchGrants,
      grant => grant.Principal == InstallerPrincipal.AuditSigner);
    Assert.DoesNotContain(DirectoryDefinition(@"supervisor\recovery-vault").Grants,
      grant => grant.Principal == InstallerPrincipal.AuditSigner);
    Assert.DoesNotContain(DirectoryDefinition(@"supervisor\secret-vault").Grants,
      grant => grant.Principal == InstallerPrincipal.AuditSigner);
  }

  [Fact]
  public void ServiceDescriptorContainsOnlyDeclaredAllowAces()
  {
    var identities = Enum.GetValues<InstallerPrincipal>().ToDictionary(
      principal => principal,
      principal => new SecurityIdentifier($"S-1-5-21-100-200-300-{1000 + (int)principal}"));
    var definition = ServiceDefinition(InstallerConstants.UpdateSupervisorService);

    var bytes = ServiceDaclHardener.BuildDescriptorForTest(definition, identities);
    var descriptor = new RawSecurityDescriptor(bytes, 0);

    Assert.NotNull(descriptor.DiscretionaryAcl);
    Assert.Equal(definition.Grants.Count, descriptor.DiscretionaryAcl.Count);
    Assert.All(descriptor.DiscretionaryAcl.Cast<GenericAce>(), ace =>
      Assert.Equal(AceType.AccessAllowed, ace.AceType));
  }

  [Fact]
  public void SevenExactInboundBlockTargetsAreDeclared()
  {
    var rules = FirewallBlueprint.Build(BinaryRoot);

    Assert.Equal(7, rules.Count);
    Assert.Equal(7, rules.Select(rule => rule.Name).Distinct(StringComparer.Ordinal).Count());
    Assert.All(rules, rule =>
    {
      Assert.StartsWith(
        Path.GetFullPath(BinaryRoot) + Path.DirectorySeparatorChar,
        rule.ApplicationPath,
        StringComparison.OrdinalIgnoreCase);
      Assert.EndsWith(".exe", rule.ApplicationPath, StringComparison.OrdinalIgnoreCase);
      Assert.Contains("Block inbound", rule.Name, StringComparison.Ordinal);
    });
  }

  [Fact]
  public void EnforcementSupervisorsCanMutateOnlyTheirOwnStateRoots()
  {
    var egress = DirectoryDefinition(@"supervisor\egress-supervisor");
    var privilegedCommand = DirectoryDefinition(
      @"supervisor\privileged-command-supervisor");

    Assert.Contains(egress.Grants, grant =>
      grant.Principal == InstallerPrincipal.EgressSupervisor
      && grant.Rights.HasFlag(FileSystemRights.Modify));
    Assert.DoesNotContain(egress.Grants, grant => grant.Principal is
      InstallerPrincipal.CompanionService
      or InstallerPrincipal.PrivilegedCommandSupervisor
      or InstallerPrincipal.UpdateSupervisor);
    Assert.Contains(privilegedCommand.Grants, grant =>
      grant.Principal == InstallerPrincipal.PrivilegedCommandSupervisor
      && grant.Rights.HasFlag(FileSystemRights.Modify));
    Assert.DoesNotContain(privilegedCommand.Grants, grant => grant.Principal is
      InstallerPrincipal.CompanionService
      or InstallerPrincipal.EgressSupervisor
      or InstallerPrincipal.UpdateSupervisor);

    Assert.DoesNotContain(DirectoryDefinition("application-versions").Grants,
      grant => grant.Principal is InstallerPrincipal.EgressSupervisor
        or InstallerPrincipal.PrivilegedCommandSupervisor);
    Assert.DoesNotContain(DirectoryDefinition("application-state").Grants,
      grant => grant.Principal is InstallerPrincipal.EgressSupervisor
        or InstallerPrincipal.PrivilegedCommandSupervisor);
  }

  private static DataAclDefinition DirectoryDefinition(string path) =>
    Assert.Single(AclBlueprint.DataDirectories.Where(definition =>
      string.Equals(definition.RelativePath, path, StringComparison.Ordinal)));

  private static ServiceAclDefinition ServiceDefinition(string name) =>
    Assert.Single(ServiceAclBlueprint.Services.Where(definition =>
      string.Equals(definition.ServiceName, name, StringComparison.Ordinal)));
}
