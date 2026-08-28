using System.Diagnostics;
using System.Security.Principal;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Channel;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Configuration;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Enforcement;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Execution;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Security;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.State;
using Itemba.Msaidizi.PrivilegedCommandSupervisor.Supervision;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options =>
  options.ServiceName = SupervisorServiceIdentity.ServiceName);

var configured = builder.Configuration
  .GetSection(PrivilegedCommandSupervisorOptions.SectionName)
  .Get<PrivilegedCommandSupervisorOptions>()
  ?? new PrivilegedCommandSupervisorOptions();

if (!configured.Enabled)
{
  builder.Services.AddHostedService<DisabledSupervisorWorker>();
  await builder.Build().RunAsync();
  return;
}

configured.Validate();
if (TrustedKillSwitch.IsEngaged(configured.KillSwitchPath))
{
  throw new InvalidOperationException(
    "The shared trusted-root kill switch is engaged.");
}
ValidateServiceIdentity(configured.SupervisorServiceSid);
ProcessIdentityAccessPolicy.GrantFixedCompanionIdentityRead();
RuntimeMeasurementVerifier.VerifyTrustedDirectory(configured.StateRoot);
RuntimeMeasurementVerifier.VerifyCurrentExecutable(
  configured.ExpectedSupervisorImageSha256);

builder.Services.AddSingleton(configured);
builder.Services.AddSingleton<IBootIdentity, WindowsBootIdentity>();
builder.Services.AddSingleton<IIsolationEvidenceSigner>(_ =>
  new CertificateStoreIsolationEvidenceSigner(configured));
builder.Services.AddSingleton<IIsolationLifecycleStore>(_ =>
  new FileIsolationLifecycleStore(
    configured.JournalPath,
      requirePreprovisionedFiles: true));
builder.Services.AddSingleton<IActionVerificationKeyResolver,
  PinnedActionTokenVerificationKeyResolver>();
builder.Services.AddSingleton<IActionTokenVerifier>(provider =>
  new Es256ActionTokenVerifier(
    new ActionTokenVerificationSettings(
      configured.ActionTokenExpectedIssuer,
      configured.ActionTokenExpectedAudience,
      configured.ActionTokenExpectedSubject,
      configured.ActionTokenAllowedClockSkew,
      configured.ActionTokenMaximumLifetime),
    provider.GetRequiredService<IActionVerificationKeyResolver>()));
builder.Services.AddSingleton<IDriverAttestationVerificationKeyResolver,
  PinnedDriverAttestationVerificationKeyResolver>();
builder.Services.AddSingleton<IPrivilegedCommandKernelEnforcer,
  WindowsKernelIsolationDriverClient>();
builder.Services.AddSingleton<IsolationLifecycleEngine>();
builder.Services.AddHostedService<IsolationKillSwitchMonitor>();
builder.Services.AddHostedService<NamedPipeIsolationSupervisorServer>();

await builder.Build().RunAsync();

static void ValidateServiceIdentity(string requiredServiceSid)
{
  if (!OperatingSystem.IsWindows()
    || Environment.UserInteractive
    || Process.GetCurrentProcess().SessionId != 0)
  {
    throw new UnauthorizedAccessException(
      "The privileged-command supervisor must run non-interactively in session zero.");
  }

  var configuredSid = new SecurityIdentifier(requiredServiceSid);
  var fixedServiceSid = new SecurityIdentifier(
    SupervisorServiceIdentity.RequiredServiceSid);
  if (!configuredSid.Equals(fixedServiceSid))
  {
    throw new UnauthorizedAccessException(
      "The configured supervisor SID does not match the fixed SCM service identity.");
  }

  using var identity = WindowsIdentity.GetCurrent(TokenAccessLevels.Query);
  var localSystem = new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null);
  if (identity.User is null
    || !localSystem.Equals(identity.User)
    || identity.Groups is null
    || !identity.Groups.Contains(fixedServiceSid)
    || !RestrictedServiceTokenValidator.IsRestrictedTo(
      identity.AccessToken,
      fixedServiceSid))
  {
    throw new UnauthorizedAccessException(
      "The privileged-command supervisor must run as LocalSystem with its restricted service SID.");
  }
}
