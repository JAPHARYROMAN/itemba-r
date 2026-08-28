using Itemba.Msaidizi.Companion.Contracts.Capabilities;
using Itemba.Msaidizi.Companion.Contracts.Channel;
using Itemba.Msaidizi.Companion.Contracts.Journal;
using Itemba.Msaidizi.Companion.Contracts.Security;
using Itemba.Msaidizi.Companion.Service;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Channel;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Execution;
using Itemba.Msaidizi.Companion.Service.Journal;
using Itemba.Msaidizi.Companion.Service.Security;
using Itemba.Msaidizi.Companion.Service.SessionBridge;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using System.Security.Cryptography;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(service =>
{
  service.ServiceName = "Itemba Msaidizi Companion";
});

builder.Services.AddOptions<CompanionOptions>()
  .Bind(builder.Configuration.GetSection(CompanionOptions.SectionName));
builder.Services.AddOptions<BrokerChannelOptions>()
  .Bind(builder.Configuration.GetSection(BrokerChannelOptions.SectionName));
builder.Services.AddOptions<TokenVerificationOptions>()
  .Bind(builder.Configuration.GetSection(TokenVerificationOptions.SectionName));
builder.Services.AddOptions<HostCapabilityOptions>()
  .Bind(builder.Configuration.GetSection(HostCapabilityOptions.SectionName));
builder.Services.AddOptions<PrivilegedCommandOptions>()
  .Bind(builder.Configuration.GetSection(PrivilegedCommandOptions.SectionName));
builder.Services.AddOptions<PrivilegedCommandIsolationClientOptions>()
  .Bind(builder.Configuration.GetSection(
    PrivilegedCommandIsolationClientOptions.SectionName));
builder.Services.AddOptions<SystemPowerOptions>()
  .Bind(builder.Configuration.GetSection(SystemPowerOptions.SectionName));
builder.Services.AddOptions<ExternalActionOptions>()
  .Bind(builder.Configuration.GetSection(ExternalActionOptions.SectionName));
builder.Services.AddOptions<SessionBridgeOptions>()
  .Bind(builder.Configuration.GetSection(SessionBridgeOptions.SectionName));
builder.Services.AddOptions<SecretProvisioningOptions>()
  .Bind(builder.Configuration.GetSection(SecretProvisioningOptions.SectionName));
builder.Services.AddOptions<EgressAttestationTrustOptions>()
  .Bind(builder.Configuration.GetSection(EgressAttestationTrustOptions.SectionName));
builder.Services.AddOptions<EgressSupervisorClientOptions>()
  .Bind(builder.Configuration.GetSection(EgressSupervisorClientOptions.SectionName));
builder.Services.AddOptions<EgressSupervisorFlowClientOptions>()
  .Bind(builder.Configuration.GetSection(EgressSupervisorFlowClientOptions.SectionName));

builder.Services.AddSingleton<IActionVerificationKeyResolver,
  CertificateStoreActionVerificationKeyResolver>();
builder.Services.AddSingleton<IActionTokenVerifier>(services =>
{
  var options = services.GetRequiredService<IOptions<TokenVerificationOptions>>().Value;
  return new Es256ActionTokenVerifier(
    new ActionTokenVerificationSettings(
      options.ExpectedIssuer,
      options.ExpectedAudience,
      options.ExpectedSubject,
      TimeSpan.FromSeconds(Math.Clamp(options.AllowedClockSkewSeconds, 0, 120)),
      TimeSpan.FromSeconds(Math.Clamp(options.MaximumTokenLifetimeSeconds, 30, 900))),
    services.GetRequiredService<IActionVerificationKeyResolver>());
});
builder.Services.AddSingleton<IFenceTokenVerifier>(services =>
{
  var options = services.GetRequiredService<IOptions<TokenVerificationOptions>>().Value;
  return new Es256FenceTokenVerifier(
    new ActionTokenVerificationSettings(
      options.ExpectedIssuer,
      options.ExpectedAudience,
      options.ExpectedSubject,
      TimeSpan.FromSeconds(Math.Clamp(options.AllowedClockSkewSeconds, 0, 120)),
      TimeSpan.FromSeconds(Math.Clamp(options.MaximumTokenLifetimeSeconds, 30, 900))),
    services.GetRequiredService<IActionVerificationKeyResolver>());
});
builder.Services.AddSingleton<IActionJournal>(services =>
  new FileHashChainActionJournal(
    services.GetRequiredService<IOptions<CompanionOptions>>().Value.JournalPath));
builder.Services.AddSingleton<IActionResultStore, FileProtectedActionResultStore>();
builder.Services.AddSingleton<ITrustedRootGuard, TrustedRootGuard>();
builder.Services.AddSingleton<IEgressBoundaryClient>(services =>
  EgressBoundaryClientFactory.Create(
    services.GetRequiredService<IOptions<EgressSupervisorClientOptions>>(),
    services.GetRequiredService<IOptions<CompanionOptions>>(),
    services.GetRequiredService<IOptions<EgressAttestationTrustOptions>>()));
builder.Services.AddSingleton<IEgressAttestationKeyResolver>(services =>
{
  var options = services.GetRequiredService<IOptions<EgressAttestationTrustOptions>>();
  return options.Value.Enabled
    ? new CertificateStoreEgressAttestationKeyResolver(
      options,
      services.GetRequiredService<IOptions<BrokerChannelOptions>>())
    : new RejectingEgressAttestationKeyResolver();
});
builder.Services.AddSingleton(services => new EgressBoundaryContractVerifier(
  EgressBoundaryVerificationSettings.Strict(
    services.GetRequiredService<IOptions<CompanionOptions>>().Value.DeviceId),
  services.GetRequiredService<IEgressAttestationKeyResolver>()));
builder.Services.AddSingleton<ICapabilityBoundaryAttestationReplayGuard,
  InMemoryCapabilityBoundaryAttestationReplayGuard>();
builder.Services.AddSingleton(services => new CapabilityBoundaryAttestationVerifier(
  services.GetRequiredService<IOptions<CompanionOptions>>().Value.DeviceId,
  TimeSpan.FromSeconds(30),
  TimeSpan.FromSeconds(120),
  services.GetRequiredService<IEgressAttestationKeyResolver>(),
  services.GetRequiredService<ICapabilityBoundaryAttestationReplayGuard>()));
builder.Services.AddSingleton<ICapabilityBoundaryAttestationProvider,
  CapabilityBoundaryAttestationProvider>();
builder.Services.AddSingleton<IEgressReceiptReplayStore>(services =>
  new FileEgressReceiptReplayStore(
    services.GetRequiredService<IOptions<CompanionOptions>>()
      .Value.EgressReceiptReplayPath,
    requireInstallerBoundary: true));
builder.Services.AddSingleton<EgressBoundaryDispatchLatch>();
// The coordinator always carries the one-way isolation fuse, even when the
// packaged configuration exposes no privileged-command adapter. Keeping this
// registration unconditional makes the default fail-closed host constructible.
builder.Services.AddSingleton<PrivilegedCommandIsolationDispatchLatch>();
// Registered before CompanionWorker so corrupt, partial, full, or concurrently
// owned replay state prevents broker intake before an external effect.
builder.Services.AddHostedService<EgressReceiptReplayStartupVerifier>();
builder.Services.AddSingleton<ILocalSystemEgressEvidenceVerifier,
  LocalSystemEgressEvidenceVerifier>();
builder.Services.AddSingleton<IDeviceIdentityProvisioner, DeviceIdentityProvisioner>();
builder.Services.AddSingleton<SupervisorPathPolicy>();
builder.Services.AddSingleton<FileHostSecretReferenceVault>();
builder.Services.AddSingleton<IHostSecretReferenceVault>(services =>
  services.GetRequiredService<FileHostSecretReferenceVault>());
builder.Services.AddSingleton<ITrustedSecretProvisioner>(services =>
  services.GetRequiredService<FileHostSecretReferenceVault>());
if (builder.Configuration.GetValue<bool>($"{SecretProvisioningOptions.SectionName}:Enabled"))
{
  builder.Services.AddSingleton<SecretProvisioningBindingCatalog>();
  builder.Services.AddSingleton<FileSecretProvisioningAuditJournal>();
  builder.Services.AddSingleton<SecretProvisioningCoordinator>();
  builder.Services.AddSingleton<NamedPipeSecretProvisioningService>();
  builder.Services.AddHostedService(services =>
    services.GetRequiredService<NamedPipeSecretProvisioningService>());
}

builder.Services.AddSingleton<IOutboundCompanionChannel>(services =>
  services.GetRequiredService<IOptions<BrokerChannelOptions>>().Value.Enabled
    ? new HttpPollingCompanionChannel(
      services.GetRequiredService<IOptions<BrokerChannelOptions>>(),
      services.GetRequiredService<IOptions<CompanionOptions>>(),
      services.GetRequiredService<IDeviceIdentityProvisioner>(),
      services.GetRequiredService<ILogger<HttpPollingCompanionChannel>>())
    : ActivatorUtilities.CreateInstance<DisabledOutboundCompanionChannel>(services));
builder.Services.AddSingleton<IJournalReconciliationGate, JournalReconciliationGate>();

builder.Services.AddSingleton<IHostCapabilityAdapter, NoOpCapabilityAdapter>();
builder.Services.AddSingleton<IHostCapabilityAdapter, SystemStatusCapabilityAdapter>();
if (builder.Configuration.GetValue<bool>($"{ExternalActionOptions.SectionName}:Enabled"))
{
  builder.Services.AddSingleton<ExternalActionPolicy>();
  builder.Services.AddSingleton<IExternalActionTransport>(services =>
    ExternalActionTransportFactory.Create(
      services.GetRequiredService<IOptions<EgressSupervisorClientOptions>>(),
      services.GetRequiredService<IOptions<EgressSupervisorFlowClientOptions>>()));
  builder.Services.AddSingleton<ExternalActionExecutor>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, ExternalEmailSendCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, ExternalMessageSendCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, ExternalPublishCreateCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, ExternalPurchaseSubmitCapabilityAdapter>();
}
if (builder.Configuration.GetValue<bool>($"{HostCapabilityOptions.SectionName}:Enabled"))
{
  builder.Services.AddSingleton<FileHostRecoveryVault>();
  builder.Services.AddSingleton<JournaledHostRecoveryVault>();
  builder.Services.AddSingleton<IHostRecoveryVault>(services =>
    services.GetRequiredService<JournaledHostRecoveryVault>());
  builder.Services.AddSingleton<ITrustedHostRecoveryRecordReader>(services =>
    services.GetRequiredService<FileHostRecoveryVault>());
  builder.Services.AddSingleton<ITrustedQuarantineRecoveryExecutor,
    TrustedQuarantineRecoveryExecutor>();
  builder.Services.AddSingleton<ITrustedFileSystemRecoveryExecutor,
    TrustedFileSystemRecoveryExecutor>();
  builder.Services.AddSingleton<IAdministrativeRecoveryOperation,
    RegistryAdministrativeRecoveryOperation>();
  builder.Services.AddSingleton<IAdministrativeRecoveryOperation,
    MachineEnvironmentAdministrativeRecoveryOperation>();
  builder.Services.AddSingleton<IAdministrativeRecoveryOperation,
    WindowsServiceAdministrativeRecoveryOperation>();
  builder.Services.AddSingleton<IAdministrativeRecoveryOperation,
    WindowsServiceStartModeAdministrativeRecoveryOperation>();
  builder.Services.AddSingleton<IAdministrativeRecoveryOperation,
    ScheduledTaskAdministrativeRecoveryOperation>();
  builder.Services.AddSingleton<IAdministrativeRecoveryOperation,
    LocalAccountAdministrativeRecoveryOperation>();
  builder.Services.AddSingleton<IAdministrativeRecoveryOperation,
    LocalGroupAdministrativeRecoveryOperation>();
  builder.Services.AddSingleton<IAdministrativeRecoveryOperation,
    LocalUserRightAdministrativeRecoveryOperation>();
  builder.Services.AddSingleton<IAdministrativeRecoveryOperation,
    NetworkAdapterAdministrativeRecoveryOperation>();
  builder.Services.AddSingleton<IAdministrativeRecoveryOperation,
    PrinterAdministrativeRecoveryOperation>();
  builder.Services.AddSingleton<IAdministrativeRecoveryOperation,
    PowerSettingsAdministrativeRecoveryOperation>();
  builder.Services.AddSingleton<IAdministrativeRecoveryOperation,
    TimeZoneAdministrativeRecoveryOperation>();
  builder.Services.AddSingleton<IAdministrativeRecoveryOperation,
    FileAclAdministrativeRecoveryOperation>();
  builder.Services.AddSingleton<ITrustedAdministrativeRecoveryExecutor,
    TrustedAdministrativeRecoveryExecutor>();
  builder.Services.AddSingleton<IHostMutationCommitObserver, NoOpHostMutationCommitObserver>();
  builder.Services.AddSingleton<IArchiveExtractCommitObserver,
    NoOpArchiveExtractCommitObserver>();
  builder.Services.AddSingleton<GovernedSystemToolRunner>();
  builder.Services.AddSingleton<OwnedProcessManager>();
  builder.Services.AddSingleton<RegistryTargetPolicy>();
  builder.Services.AddSingleton<MachineEnvironmentPolicy>();
  builder.Services.AddSingleton<WindowsServicePolicy>();
  builder.Services.AddSingleton<ScheduledTaskPolicy>();
  builder.Services.AddSingleton<MsiPackagePolicy>();
  builder.Services.AddSingleton<LocalIdentityPolicy>();
  builder.Services.AddSingleton<LocalUserRightPolicy>();
  builder.Services.AddSingleton<NetworkAdapterPolicy>();
  builder.Services.AddSingleton<PrinterPolicy>();
  builder.Services.AddSingleton<PowerSchemePolicy>();
  builder.Services.AddSingleton<TimeZonePolicy>();
  builder.Services.AddSingleton<FileAclPolicy>();
  builder.Services.AddSingleton<IWindowsLocalIdentityManager, WindowsLocalIdentityManager>();
  builder.Services.AddSingleton<IWindowsLocalUserRightManager,
    WindowsLocalUserRightManager>();
  builder.Services.AddSingleton<IWindowsNetworkAdapterManager, WindowsNetworkAdapterManager>();
  builder.Services.AddSingleton<IWindowsPrinterManager, WindowsPrinterManager>();
  builder.Services.AddSingleton<IWindowsPowerSettingsManager, WindowsPowerSettingsManager>();
  builder.Services.AddSingleton<IWindowsTimeZoneManager, WindowsTimeZoneManager>();
  builder.Services.AddSingleton<IWindowsDisplayInventory, WindowsDisplayInventory>();
  builder.Services.AddSingleton<IWindowsSystemProcessInventory,
    WindowsSystemProcessInventory>();
  builder.Services.AddSingleton<IInstalledSoftwareInventory,
    WindowsInstalledSoftwareInventory>();
  builder.Services.AddSingleton<IWindowsFileAclManager, WindowsFileAclManager>();
  builder.Services.AddSingleton<IWindowsServiceStartModeManager,
    WindowsServiceStartModeManager>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, FileSystemEntryStatCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, FileSystemAclReadCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, FileSystemAclSetCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, FileSystemFolderListCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, FileSystemSearchCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, FileSystemFileWriteCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, FileSystemFolderCreateCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, FileSystemEntryCopyCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, FileSystemEntryMoveCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, FileSystemArchiveCreateCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter,
    FileSystemArchiveExtractCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, FileSystemEntryQuarantineCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, OwnedProcessLaunchCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, OwnedProcessStatusCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, OwnedProcessTerminateCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, RegistryValueReadCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, RegistryValueSetCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, RegistryValueDeleteCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, MachineEnvironmentReadCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, MachineEnvironmentSetCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, MachineEnvironmentDeleteCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, WindowsServiceStatusCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, WindowsServiceStartCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, WindowsServiceStopCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter,
    WindowsServiceStartModeReadCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter,
    WindowsServiceStartModeSetCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter,
    ScheduledTaskDefinitionReadCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, ScheduledTaskEnabledSetCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, ScheduledTaskRunCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, MsiSoftwareStatusCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, MsiSoftwareInstallCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, MsiSoftwareUninstallCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, LocalAccountStatusCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, LocalAccountEnabledSetCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter,
    LocalGroupMembershipReadCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter,
    LocalGroupMembershipSetCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter,
    LocalUserRightReadCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter,
    LocalUserRightSetCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, NetworkAdapterInspectCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter,
    NetworkAdapterEnabledSetCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, PrinterDiscoveryCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, PrinterQueueStatusCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, PrinterQueuePausedSetCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, DisplayInventoryReadCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter,
    ProcessSystemInventoryReadCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter>(services =>
    new InstalledSoftwareInventoryReadCapabilityAdapter(
      services.GetRequiredService<IInstalledSoftwareInventory>(),
      services.GetRequiredService<IOptions<HostCapabilityOptions>>()
        .Value.MaximumInstalledSoftwareInventoryEntries));
  builder.Services.AddSingleton<IHostCapabilityAdapter, ActivePowerSchemeReadCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, ActivePowerSchemeSetCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, MonitorTimeoutReadCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, MonitorTimeoutSetCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, TimeZoneReadCapabilityAdapter>();
  builder.Services.AddSingleton<IHostCapabilityAdapter, TimeZoneSetCapabilityAdapter>();
  if (builder.Configuration.GetValue<bool>(
    $"{PrivilegedCommandOptions.SectionName}:Enabled"))
  {
    builder.Services.AddSingleton<PrivilegedCommandPolicy>();
    PrivilegedCommandIsolationClientFactory.Register(builder.Services);
    builder.Services.AddSingleton<IPrivilegedCommandIsolationReplayStore>(services =>
      new FilePrivilegedCommandIsolationReplayStore(
        services.GetRequiredService<IOptions<PrivilegedCommandOptions>>()
          .Value.IsolationReplayStorePath));
    // Registered before CompanionWorker: IHostedService startup is ordered, so
    // pending signed reservation/bind state fences broker intake until it has
    // been durably settled by the trusted supervisor.
    builder.Services.AddHostedService<PrivilegedCommandIsolationStartupReconciler>();
    builder.Services.AddSingleton<PrivilegedOwnedCommandRunner>();
    builder.Services.AddSingleton<IHostCapabilityAdapter,
      PrivilegedCommandExecuteCapabilityAdapter>();
  }
  if (builder.Configuration.GetValue<bool>($"{SystemPowerOptions.SectionName}:Enabled"))
  {
    builder.Services.AddSingleton<SystemPowerPolicy>();
    builder.Services.AddSingleton<IWindowsSystemPowerManager, WindowsSystemPowerManager>();
    builder.Services.AddSingleton<IHostCapabilityAdapter, BootSessionReadCapabilityAdapter>();
    builder.Services.AddSingleton<IHostCapabilityAdapter,
      SystemRestartScheduleCapabilityAdapter>();
  }
  if (builder.Configuration.GetValue<bool>(
    $"{HostCapabilityOptions.SectionName}:PermanentDeleteEnabled"))
  {
    builder.Services.AddSingleton<IHostCapabilityAdapter,
      FileSystemEntryPermanentDeleteCapabilityAdapter>();
  }
}
if (builder.Configuration.GetValue<bool>($"{SessionBridgeOptions.SectionName}:Enabled"))
{
  var browserExternalEffectsRequested = builder.Configuration.GetValue<bool>(
    $"{SessionBridgeOptions.SectionName}:BrowserExternalEffectsEnabled");
  var emergencyCommandRequested = builder.Configuration.GetValue<bool>(
    $"{SessionBridgeOptions.SectionName}:EmergencyCommandEnabled");
  var capabilityBoundaryAttestation = await CapabilityBoundaryProgramBootstrap
    .TryResolveAsync(builder.Configuration, CancellationToken.None)
    .ConfigureAwait(false);
  var descriptors = StandardUserCapabilityCatalog.DescribeRequestedSurface(
    browserExternalEffectsRequested,
    emergencyCommandRequested);
  builder.Services.AddSingleton<ICapabilityBoundaryActivationState>(
    new CapabilityBoundaryActivationState(
      browserExternalEffectsRequested,
      emergencyCommandRequested,
      capabilityBoundaryAttestation));
  builder.Services.AddHostedService<CapabilityBoundaryActivationRenewalService>();
  builder.Services.AddSingleton<NamedPipeSessionBridge>();
  builder.Services.AddSingleton<IUserSessionBridge>(services =>
    services.GetRequiredService<NamedPipeSessionBridge>());
  builder.Services.AddHostedService(services =>
    services.GetRequiredService<NamedPipeSessionBridge>());
  foreach (var descriptor in descriptors)
  {
    builder.Services.AddSingleton<IHostCapabilityAdapter>(services =>
      new SessionCapabilityProxyAdapter(
        descriptor,
        services.GetRequiredService<IUserSessionBridge>(),
        services.GetRequiredService<IHostSecretReferenceVault>(),
        services.GetRequiredService<ICapabilityBoundaryActivationState>()));
  }
}
builder.Services.AddSingleton<CapabilityRegistry>();
builder.Services.AddSingleton<ActionExecutionCoordinator>();
builder.Services.AddSingleton<CapabilityManifestPublisher>();
builder.Services.AddHostedService<CompanionWorker>();

await builder.Build().RunAsync().ConfigureAwait(false);

/// <summary>
/// Selects the independently deployed isolation client only from a complete,
/// exact, deployment-owned trust bundle. Any disabled, partial, malformed, or
/// cross-device configuration retains the non-accepting production fallback.
/// </summary>
namespace Itemba.Msaidizi.Companion.Service.Capabilities
{
  internal static class PrivilegedCommandIsolationClientFactory
  {
    internal const string NamedPipeTransport = "named-pipe-v2";

    public static void Register(IServiceCollection services)
    {
      ArgumentNullException.ThrowIfNull(services);
      services.AddSingleton<RejectingPrivilegedCommandTrustedRootIsolationGate>();
      services.AddSingleton<IPrivilegedCommandTrustedRootIsolationGate>(provider =>
        Create(
          provider.GetRequiredService<
            IOptions<PrivilegedCommandIsolationClientOptions>>().Value,
          provider.GetRequiredService<IOptions<CompanionOptions>>().Value,
          provider.GetRequiredService<
            RejectingPrivilegedCommandTrustedRootIsolationGate>()));
      services.AddSingleton<IPrivilegedCommandTrustedRootIsolationRecovery>(provider =>
        (IPrivilegedCommandTrustedRootIsolationRecovery)provider.GetRequiredService<
          IPrivilegedCommandTrustedRootIsolationGate>());
    }

    public static IPrivilegedCommandTrustedRootIsolationGate Create(
      PrivilegedCommandIsolationClientOptions options,
      CompanionOptions companion,
      RejectingPrivilegedCommandTrustedRootIsolationGate fallback)
    {
      ArgumentNullException.ThrowIfNull(options);
      ArgumentNullException.ThrowIfNull(companion);
      ArgumentNullException.ThrowIfNull(fallback);
      return TryCreate(options, companion, out var client) ? client! : fallback;
    }

    private static bool TryCreate(
      PrivilegedCommandIsolationClientOptions options,
      CompanionOptions companion,
      out NamedPipePrivilegedCommandTrustedRootIsolationClient? client)
    {
      client = null;
      if (!IsComplete(options, companion))
      {
        return false;
      }

      try
      {
        var pins = CreatePins(options);
        if (pins.Select(pin => pin.KeyId).Distinct(StringComparer.Ordinal).Count() != 4
          || pins.Select(pin => pin.SubjectPublicKeyInfoBase64)
            .Distinct(StringComparer.Ordinal).Count() != 4)
        {
          return false;
        }

        var resolver = new ExactPurposeP256PublicKeyResolver(pins);
        var verification = new PrivilegedCommandIsolationVerificationSettings(
          options.ExpectedDeviceId,
          options.ExpectedIsolationPolicySha256,
          options.ExpectedDriverMeasurementSha256,
          options.ExpectedServiceMeasurementSha256,
          TimeSpan.FromSeconds(options.AllowedClockSkewSeconds),
          TimeSpan.FromSeconds(options.MaximumReservationRequestAgeSeconds),
          TimeSpan.FromSeconds(options.MaximumReservationLeaseLifetimeSeconds),
          TimeSpan.FromSeconds(options.MaximumBindAcknowledgementLifetimeSeconds),
          TimeSpan.FromSeconds(options.MaximumExecutionDurationSeconds),
          TimeSpan.FromSeconds(options.MaximumReceiptDelaySeconds));
        _ = new PrivilegedCommandIsolationContractVerifier(verification, resolver);

        client = new NamedPipePrivilegedCommandTrustedRootIsolationClient(
          new PrivilegedCommandTrustedRootPipeClientOptions
          {
            Enabled = true,
            PipeName = options.PipeName,
            ExpectedSupervisorImagePath = options.ExpectedSupervisorImagePath,
            ExpectedSupervisorImageSha256 = options.ExpectedSupervisorImageSha256,
            ExpectedSupervisorServiceSid = options.ExpectedSupervisorServiceSid,
            MaximumFrameBytes = options.MaximumFrameBytes,
            ConnectTimeout = TimeSpan.FromMilliseconds(
              options.ConnectTimeoutMilliseconds),
            OperationTimeout = TimeSpan.FromMilliseconds(
              options.OperationTimeoutMilliseconds),
            ReservationRequestLifetime = TimeSpan.FromSeconds(
              options.ReservationRequestLifetimeSeconds),
            Verification = verification,
          },
          resolver);
        return true;
      }
      catch (Exception exception) when (exception is ArgumentException
        or CryptographicException
        or InvalidOperationException
        or NotSupportedException)
      {
        client = null;
        return false;
      }
    }

    private static bool IsComplete(
      PrivilegedCommandIsolationClientOptions options,
      CompanionOptions companion) =>
      OperatingSystem.IsWindows()
      && options.Enabled
      && string.Equals(options.Transport, NamedPipeTransport, StringComparison.Ordinal)
      && options.ProtocolVersion == PrivilegedCommandIsolationPipeProtocol.Version
      && PrivilegedCommandIsolationPipeProtocol.IsSafePipeName(options.PipeName)
      && IsSafeAbsoluteLocalPath(options.ExpectedSupervisorImagePath)
      && IsCanonicalSha256(options.ExpectedSupervisorImageSha256)
      && TrustedSupervisorProcessAccessGrant.IsCanonicalRestrictedServiceSid(
        options.ExpectedSupervisorServiceSid)
      && string.Equals(
        options.ExpectedSupervisorServiceSid,
        PrivilegedCommandIsolationSupervisorIdentity.ServiceSid,
        StringComparison.Ordinal)
      && IsCanonicalGuid(options.ExpectedDeviceId)
      && string.Equals(
        options.ExpectedDeviceId,
        companion.DeviceId,
        StringComparison.Ordinal)
      && IsCanonicalSha256(options.ExpectedIsolationPolicySha256)
      && IsCanonicalSha256(options.ExpectedDriverMeasurementSha256)
      && IsCanonicalSha256(options.ExpectedServiceMeasurementSha256)
      && options.MaximumFrameBytes
        is >= PrivilegedCommandIsolationPipeProtocol.MinimumFrameBytes
        and <= PrivilegedCommandIsolationPipeProtocol.AbsoluteMaximumFrameBytes
      && options.ConnectTimeoutMilliseconds is >= 100 and <= 30_000
      && options.OperationTimeoutMilliseconds is >= 100 and <= 30_000
      && options.ReservationRequestLifetimeSeconds is >= 1 and <= 120
      && options.AllowedClockSkewSeconds is >= 0 and <= 120
      && options.MaximumReservationRequestAgeSeconds is >= 1 and <= 300
      && options.MaximumReservationLeaseLifetimeSeconds is >= 1 and <= 600
      && options.MaximumBindAcknowledgementLifetimeSeconds is >= 1 and <= 120
      && options.MaximumExecutionDurationSeconds is >= 1 and <= 7_200
      && options.MaximumReceiptDelaySeconds is >= 1 and <= 1_800;

    private static PrivilegedCommandIsolationPublicKeyPin[] CreatePins(
      PrivilegedCommandIsolationClientOptions options) =>
    [
      Pin(
        options.ReservationLeasePublicKey,
        PrivilegedCommandIsolationSignaturePurposes.ReservationLease),
      Pin(
        options.PreBindReservationReleasePublicKey,
        PrivilegedCommandIsolationSignaturePurposes.PreBindReservationRelease),
      Pin(
        options.SuspendedProcessBindAcknowledgementPublicKey,
        PrivilegedCommandIsolationSignaturePurposes
          .SuspendedProcessBindAcknowledgement),
      Pin(
        options.TerminalEnforcementReceiptPublicKey,
        PrivilegedCommandIsolationSignaturePurposes.TerminalEnforcementReceipt),
    ];

    private static PrivilegedCommandIsolationPublicKeyPin Pin(
      PrivilegedCommandIsolationPublicKeyOptions options,
      string signaturePurpose)
    {
      ArgumentNullException.ThrowIfNull(options);
      return new PrivilegedCommandIsolationPublicKeyPin(
        options.KeyId,
        signaturePurpose,
        options.SubjectPublicKeyInfoBase64);
    }

    private static bool IsCanonicalGuid(string? value) =>
      value is not null
      && Guid.TryParseExact(value, "D", out var parsed)
      && string.Equals(parsed.ToString("D"), value, StringComparison.Ordinal);

    private static bool IsCanonicalSha256(string? value) =>
      PayloadDigest.IsSha256Hex(value)
      && string.Equals(value, value?.ToLowerInvariant(), StringComparison.Ordinal);

    private static bool IsSafeAbsoluteLocalPath(string value)
    {
      if (string.IsNullOrWhiteSpace(value)
        || !Path.IsPathFullyQualified(value)
        || value.StartsWith("\\\\", StringComparison.Ordinal)
        || value.StartsWith("\\??\\", StringComparison.Ordinal)
        || value.StartsWith("\\\\?\\", StringComparison.Ordinal)
        || value.EndsWith(' ')
        || value.EndsWith('.'))
      {
        return false;
      }

      try
      {
        var fullPath = Path.GetFullPath(value);
        return string.Equals(fullPath, value, StringComparison.OrdinalIgnoreCase)
          && fullPath.IndexOf(':', 3) < 0;
      }
      catch (Exception exception) when (exception is ArgumentException
        or NotSupportedException
        or PathTooLongException)
      {
        return false;
      }
    }
  }
}
