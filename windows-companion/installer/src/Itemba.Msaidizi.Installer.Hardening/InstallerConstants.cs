namespace Itemba.Msaidizi.Installer.Hardening;

public static class InstallerConstants
{
  public const string RecoveryOperatorsGroup = "Itemba Msaidizi Recovery Operators";
  public const string CompanionService = "Itemba Msaidizi Companion";
  public const string UpdateSupervisorService = "Itemba Msaidizi Update Supervisor";
  public const string RecoverySupervisorService = "Itemba Msaidizi Recovery Supervisor";
  public const string AuditSignerService = "Itemba Msaidizi Audit Signer";
  public const string EgressSupervisorService = "Itemba Msaidizi Egress Supervisor";
  public const string PrivilegedCommandSupervisorService =
    "Itemba Msaidizi Privileged Command Supervisor";
  public const string FirewallGrouping = "Itemba Msaidizi Windows Companion";

  public static readonly IReadOnlyDictionary<string, string> Executables =
    new Dictionary<string, string>(StringComparer.Ordinal)
    {
      ["Companion"] = @"Service\Itemba.Msaidizi.Companion.Service.exe",
      ["Agent"] = @"Agent\Itemba.Msaidizi.Companion.Agent.exe",
      ["UpdateSupervisor"] = @"UpdateSupervisor\Itemba.Msaidizi.UpdateSupervisor.exe",
      ["RecoverySupervisor"] = @"RecoverySupervisor\Itemba.Msaidizi.RecoverySupervisor.exe",
      ["AuditSigner"] = @"AuditSigner\Itemba.Msaidizi.AuditSigner.exe",
      ["EgressSupervisor"] = @"EgressSupervisor\Itemba.Msaidizi.EgressSupervisor.exe",
      ["PrivilegedCommandSupervisor"] =
        @"PrivilegedCommandSupervisor\Itemba.Msaidizi.PrivilegedCommandSupervisor.exe",
    };
}
