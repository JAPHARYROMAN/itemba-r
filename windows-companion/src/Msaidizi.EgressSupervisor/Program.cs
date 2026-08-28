using System.Security.Principal;
using Itemba.Msaidizi.EgressSupervisor;
using Itemba.Msaidizi.EgressSupervisor.Security;
using Microsoft.Extensions.Hosting;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(service =>
{
  service.ServiceName = EgressSupervisorTrustIdentity.ServiceName;
});

var options = new EgressSupervisorOptions();
builder.Configuration.GetSection(EgressSupervisorOptions.SectionName).Bind(options);

if (options.Enabled)
{
  ValidateActiveServiceContext(options);
}

builder.Services.AddEgressSupervisor(options);

await builder.Build().RunAsync().ConfigureAwait(false);

static void ValidateActiveServiceContext(EgressSupervisorOptions options)
{
  if (!OperatingSystem.IsWindows())
  {
    throw new InvalidOperationException("Active egress supervision requires Windows.");
  }

  using var identity = WindowsIdentity.GetCurrent();
  var systemSid = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
  var translatedSupervisorSid = (SecurityIdentifier)new NTAccount(
    "NT SERVICE",
    EgressSupervisorTrustIdentity.ServiceName).Translate(typeof(SecurityIdentifier));
  var supervisorSid = new SecurityIdentifier(
    EgressSupervisorTrustIdentity.ServiceSid);
  if (identity.User is null
    || !identity.User.Equals(systemSid)
    || !translatedSupervisorSid.Equals(supervisorSid)
    || identity.Groups is null
    || !identity.Groups.Contains(supervisorSid)
    || !RestrictedServiceTokenValidator.IsRestrictedTo(
      identity.AccessToken,
      supervisorSid)
    || !string.Equals(
      options.SupervisorServiceName,
      EgressSupervisorTrustIdentity.ServiceName,
      StringComparison.Ordinal)
    || !string.Equals(
      options.CompanionServiceName,
      EgressSupervisorTrustIdentity.CompanionServiceName,
      StringComparison.Ordinal)
    || !System.Diagnostics.Process.GetCurrentProcess().SessionId.Equals(0))
  {
    throw new InvalidOperationException(
      "Active egress supervision must run under its fixed restricted "
      + "session-zero LocalSystem service identity.");
  }

  WindowsEgressProcessObjectBoundary.GrantCompanionQueryAccess(options);

  var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
  var expectedJournal = Path.GetFullPath(Path.Combine(
    programData,
    "Itemba",
    "Msaidizi",
    "supervisor",
    "egress-supervisor",
    "lifecycle.v2.jsonl"));
  var expectedKillSwitch = Path.GetFullPath(Path.Combine(
    programData,
    "Itemba",
    "Msaidizi",
    "supervisor",
    "DISABLED"));
  var expectedSecretVault = Path.GetFullPath(Path.Combine(
    programData,
    "Itemba",
    "Msaidizi",
    "supervisor",
    "secret-vault"));
  if (string.IsNullOrWhiteSpace(options.JournalPath)
    || !string.Equals(
      Path.GetFullPath(options.JournalPath),
      expectedJournal,
      StringComparison.OrdinalIgnoreCase))
  {
    throw new InvalidOperationException(
      "The egress lifecycle journal must use its dedicated protected state root.");
  }
  if (string.IsNullOrWhiteSpace(options.KillSwitchPath)
    || !string.Equals(
      Path.GetFullPath(options.KillSwitchPath),
      expectedKillSwitch,
      StringComparison.OrdinalIgnoreCase)
    || EgressTrustedKillSwitch.IsEngaged(options.KillSwitchPath))
  {
    throw new InvalidOperationException(
      "The shared trusted-root kill switch is engaged, missing, or misconfigured.");
  }
  if (string.IsNullOrWhiteSpace(options.SecretVaultPath)
    || !string.Equals(
      Path.GetFullPath(options.SecretVaultPath),
      expectedSecretVault,
      StringComparison.OrdinalIgnoreCase)
    || !Directory.Exists(options.SecretVaultPath)
    || (File.GetAttributes(options.SecretVaultPath) & FileAttributes.ReparsePoint) != 0)
  {
    throw new InvalidOperationException(
      "The supervisor credential vault is missing, indirect, or misconfigured.");
  }
}
