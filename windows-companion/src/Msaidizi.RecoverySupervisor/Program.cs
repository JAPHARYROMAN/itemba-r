using System.Security.Cryptography.X509Certificates;
using Itemba.Msaidizi.Companion.Service.Capabilities;
using Itemba.Msaidizi.Companion.Service.Configuration;
using Itemba.Msaidizi.Companion.Service.Security;
using Itemba.Msaidizi.RecoverySupervisor;
using Itemba.Msaidizi.RecoverySupervisor.Channel;
using Itemba.Msaidizi.RecoverySupervisor.Configuration;
using Itemba.Msaidizi.RecoverySupervisor.Execution;
using Itemba.Msaidizi.RecoverySupervisor.Journal;
using Itemba.Msaidizi.RecoverySupervisor.Security;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options =>
  options.ServiceName = "Itemba Msaidizi Recovery Supervisor");

var configured = builder.Configuration
  .GetSection(RecoverySupervisorOptions.SectionName)
  .Get<RecoverySupervisorOptions>()?.Expand()
  ?? throw new InvalidOperationException("Trusted recovery supervisor configuration is missing.");
ValidateBootstrapConfiguration(configured, builder.Configuration);

builder.Services.AddOptions<CompanionOptions>()
  .Bind(builder.Configuration.GetSection(CompanionOptions.SectionName));
builder.Services.AddOptions<BrokerChannelOptions>()
  .Bind(builder.Configuration.GetSection(BrokerChannelOptions.SectionName));
builder.Services.AddOptions<HostCapabilityOptions>()
  .Bind(builder.Configuration.GetSection(HostCapabilityOptions.SectionName));
builder.Services.AddSingleton(configured);

builder.Services.AddSingleton<RecoveryManifestVerifier>();
builder.Services.AddSingleton<IRecoveryJournal>(_ =>
  new FileRecoveryJournal(configured.JournalPath));
builder.Services.AddSingleton<IRecoveryResultStore>(_ =>
  new FileRecoveryResultStore(configured.ResultCachePath));

// These implementations are internal to the companion assembly so they never
// become capability/plugin surface. This separately signed friend assembly is
// the only additional caller and receives no planner, model, or raw shell.
builder.Services.AddSingleton<SupervisorPathPolicy>();
builder.Services.AddSingleton<FileHostRecoveryVault>();
builder.Services.AddSingleton<ITrustedHostRecoveryRecordReader>(services =>
  services.GetRequiredService<FileHostRecoveryVault>());
builder.Services.AddSingleton<RegistryTargetPolicy>();
builder.Services.AddSingleton<MachineEnvironmentPolicy>();
builder.Services.AddSingleton<WindowsServicePolicy>();
builder.Services.AddSingleton<ScheduledTaskPolicy>();
builder.Services.AddSingleton<GovernedSystemToolRunner>();
builder.Services.AddSingleton<LocalIdentityPolicy>();
builder.Services.AddSingleton<LocalUserRightPolicy>();
builder.Services.AddSingleton<NetworkAdapterPolicy>();
builder.Services.AddSingleton<PrinterPolicy>();
builder.Services.AddSingleton<PowerSchemePolicy>();
builder.Services.AddSingleton<TimeZonePolicy>();
builder.Services.AddSingleton<IWindowsLocalIdentityManager, WindowsLocalIdentityManager>();
builder.Services.AddSingleton<IWindowsLocalUserRightManager,
  WindowsLocalUserRightManager>();
builder.Services.AddSingleton<IWindowsNetworkAdapterManager, WindowsNetworkAdapterManager>();
builder.Services.AddSingleton<IWindowsPrinterManager, WindowsPrinterManager>();
builder.Services.AddSingleton<IWindowsPowerSettingsManager, WindowsPowerSettingsManager>();
builder.Services.AddSingleton<IWindowsTimeZoneManager, WindowsTimeZoneManager>();
builder.Services.AddSingleton<IWindowsFileAclManager, WindowsFileAclManager>();
builder.Services.AddSingleton<IWindowsServiceStartModeManager,
  WindowsServiceStartModeManager>();
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
builder.Services.AddSingleton<ITrustedQuarantineRecoveryExecutor,
  TrustedQuarantineRecoveryExecutor>();
builder.Services.AddSingleton<ITrustedFileSystemRecoveryExecutor,
  TrustedFileSystemRecoveryExecutor>();
builder.Services.AddSingleton<ITrustedAdministrativeRecoveryExecutor,
  TrustedAdministrativeRecoveryExecutor>();
builder.Services.AddSingleton<TrustedRecoveryEngine>();

builder.Services.AddHttpClient("recovery-broker", client =>
  client.BaseAddress = EnsureTrailingSlash(configured.BrokerBaseUri))
  .ConfigurePrimaryHttpMessageHandler(() => CreateMutualTlsHandler(configured));
builder.Services.AddSingleton<IRecoveryBrokerClient>(provider =>
  new RecoveryBrokerClient(
    provider.GetRequiredService<IHttpClientFactory>().CreateClient("recovery-broker")));
builder.Services.AddHostedService<RecoverySupervisorWorker>();

await builder.Build().RunAsync().ConfigureAwait(false);

static void ValidateBootstrapConfiguration(
  RecoverySupervisorOptions options,
  IConfiguration configuration)
{
  if (!Guid.TryParse(options.DeviceId, out _) ||
      !Uri.TryCreate(options.BrokerBaseUri, UriKind.Absolute, out var broker) ||
      broker.Scheme != Uri.UriSchemeHttps ||
      options.RecoveryKeyId.Length is < 1 or > 128 ||
      options.PinnedRecoveryPublicKeySha256.Length != 64 ||
      string.IsNullOrWhiteSpace(options.EnrollmentId) !=
        string.IsNullOrWhiteSpace(options.EnrollmentCode) ||
      options.PollIntervalSeconds is < 2 or > 300)
    throw new InvalidOperationException("Trusted recovery supervisor configuration is invalid.");

  var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(options.SupervisorRoot));
  foreach (var trustedState in new[]
  {
    options.JournalPath,
    options.ResultCachePath,
    options.PinnedRecoveryPublicKeyPath,
  })
  {
    var path = Path.GetFullPath(trustedState);
    if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
      throw new InvalidOperationException("Recovery trust state must remain beneath its supervisor root.");
  }
  var supervisorParent = Directory.GetParent(root)?.FullName
    ?? throw new InvalidOperationException("The recovery supervisor root has no trusted parent.");
  var expectedKillSwitch = Path.GetFullPath(Path.Combine(supervisorParent, "DISABLED"));
  if (!string.Equals(
        Path.GetFullPath(options.KillSwitchPath),
        expectedKillSwitch,
        StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("The recovery service must use the shared trusted-root kill switch.");

  var host = configuration.GetSection(HostCapabilityOptions.SectionName)
    .Get<HostCapabilityOptions>()
    ?? throw new InvalidOperationException("Host recovery policy is missing.");
  var vault = Path.GetFullPath(Environment.ExpandEnvironmentVariables(host.RecoveryVaultPath));
  if (!host.Enabled ||
      !vault.StartsWith(
        Path.TrimEndingDirectorySeparator(supervisorParent) + Path.DirectorySeparatorChar,
        StringComparison.OrdinalIgnoreCase) ||
      vault.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException(
      "The encrypted recovery vault must be an enabled, protected sibling of the recovery service root.");
  foreach (var allowed in host.AllowedRoots)
  {
    var allowedRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(
      Environment.ExpandEnvironmentVariables(allowed.Path)));
    if (root.StartsWith(allowedRoot + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
        string.Equals(root, allowedRoot, StringComparison.OrdinalIgnoreCase))
      throw new InvalidOperationException(
        "A model-addressable host root must never contain the recovery supervisor executable or trust state.");
  }
}

static Uri EnsureTrailingSlash(string value) =>
  new(value.EndsWith('/') ? value : value + "/", UriKind.Absolute);

static HttpClientHandler CreateMutualTlsHandler(RecoverySupervisorOptions options)
{
  var thumbprint = options.ClientCertificateThumbprint.Replace(
    " ",
    string.Empty,
    StringComparison.Ordinal).ToUpperInvariant();
  using var store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
  store.Open(OpenFlags.ReadOnly);
  var certificates = store.Certificates.Find(
    X509FindType.FindByThumbprint,
    thumbprint,
    validOnly: true);
  if (certificates.Count != 1 || !certificates[0].HasPrivateKey)
    throw new InvalidOperationException(
      "Exactly one valid recovery-supervisor client certificate is required.");
  var handler = new HttpClientHandler();
  handler.ClientCertificates.Add(certificates[0]);
  handler.ClientCertificateOptions = ClientCertificateOption.Manual;
  return handler;
}
