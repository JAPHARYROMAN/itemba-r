namespace Itemba.Msaidizi.Installer.Hardening.Tests;

public sealed class InstallerAuthoringSecurityTests
{
  [Fact]
  public void HardeningRunsBeforeWindowsInstallerCanStartServices()
  {
    var package = ReadAuthoring("Package.wxs");

    Assert.Contains(
      "<Custom Action=\"ApplyInstallerHardening\" After=\"InstallServices\"",
      package,
      StringComparison.Ordinal);
    Assert.DoesNotContain("Start=\"both\"", package, StringComparison.Ordinal);
  }

  [Fact]
  public void HandleBoundPolicyLocksCanonicalNonReparseSingleLinkFiles()
  {
    var source = ReadAuthoring("HandleBoundPathSecurity.cs");

    Assert.Contains("FileFlagOpenReparsePoint", source, StringComparison.Ordinal);
    Assert.Contains("GetFinalPathNameByHandle", source, StringComparison.Ordinal);
    Assert.Contains("information.NumberOfLinks != 1", source, StringComparison.Ordinal);
    Assert.Contains(
      "expectDirectory ? FileShare.Read | FileShare.Write : FileShare.Read",
      source,
      StringComparison.Ordinal);
    Assert.Contains("SetKernelObjectSecurity", source, StringComparison.Ordinal);
  }

  [Fact]
  public void SignedHelperEmbedsEverySafeConfigurationBaseline()
  {
    var project = ReadAuthoring("Itemba.Msaidizi.Installer.Hardening.csproj");

    foreach (var name in ConfigurationProvenance.ConfigurationNames)
    {
      Assert.Contains(
        $"Itemba.Msaidizi.InstallerDefaults.{name}.appsettings.json",
        project,
        StringComparison.Ordinal);
    }
  }

  [Fact]
  public void EnforcementSupervisorsAreAutomaticRestrictedDependencies()
  {
    var package = ReadAuthoring("Package.wxs");

    Assert.Contains(
      "<ServiceDependency Id=\"Itemba Msaidizi Egress Supervisor\" />",
      package,
      StringComparison.Ordinal);
    Assert.Contains(
      "<ServiceDependency Id=\"Itemba Msaidizi Privileged Command Supervisor\" />",
      package,
      StringComparison.Ordinal);
    foreach (var serviceName in new[]
    {
      "Itemba Msaidizi Egress Supervisor",
      "Itemba Msaidizi Privileged Command Supervisor",
    })
    {
      var install = package.IndexOf(
        $"Name=\"{serviceName}\"",
        StringComparison.Ordinal);
      Assert.True(install >= 0);
      var end = package.IndexOf("</ServiceInstall>", install, StringComparison.Ordinal);
      Assert.True(end > install);
      var service = package[install..end];
      Assert.Contains("Start=\"auto\"", service, StringComparison.Ordinal);
      Assert.Contains("Account=\"LocalSystem\"", service, StringComparison.Ordinal);
      Assert.Contains("DelayedAutoStart=\"no\"", service, StringComparison.Ordinal);
      Assert.Contains("ServiceSid=\"restricted\"", service, StringComparison.Ordinal);
    }
  }

  [Fact]
  public void ProvenanceCommitsOnlyAfterEveryPrivilegedHardeningStep()
  {
    var program = ReadAuthoring("Program.cs");
    var acl = program.IndexOf("aclHardener.Apply();", StringComparison.Ordinal);
    var services = program.IndexOf("ServiceDaclHardener.Apply", StringComparison.Ordinal);
    var firewall = program.IndexOf("FirewallBlockManager.Install", StringComparison.Ordinal);
    var commit = program.IndexOf(
      "aclHardener.CommitConfigurationProvenance();",
      StringComparison.Ordinal);

    Assert.True(acl >= 0 && acl < services && services < firewall && firewall < commit);
  }

  [Fact]
  public void VmAcceptanceContainsAllAdversarialAndPreservationCases()
  {
    var vm = ReadAuthoring("Invoke-MsaidiziVmAcceptance.ps1");

    Assert.Contains("attacker-owned ProgramData parent", vm, StringComparison.Ordinal);
    Assert.Contains("junction data root", vm, StringComparison.Ordinal);
    Assert.Contains("preplanted NeverOverwrite configuration", vm, StringComparison.Ordinal);
    Assert.Contains("reinstall.provenance-preservation", vm, StringComparison.Ordinal);
  }

  private static string ReadAuthoring(string name) => File.ReadAllText(
    Path.Combine(AppContext.BaseDirectory, "Authoring", name));
}
