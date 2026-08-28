using System.Security.Cryptography.X509Certificates;
using Itemba.Msaidizi.UpdateSupervisor;
using Itemba.Msaidizi.UpdateSupervisor.Channel;
using Itemba.Msaidizi.UpdateSupervisor.Configuration;
using Itemba.Msaidizi.UpdateSupervisor.Execution;
using Itemba.Msaidizi.UpdateSupervisor.Journal;
using Itemba.Msaidizi.UpdateSupervisor.Security;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options => options.ServiceName = "Itemba Msaidizi Update Supervisor");

var configured = builder.Configuration
  .GetSection(UpdateSupervisorOptions.SectionName)
  .Get<UpdateSupervisorOptions>()?.Expand()
  ?? throw new InvalidOperationException("Trusted update supervisor configuration is missing.");
ValidateBootstrapConfiguration(configured);
builder.Services.AddSingleton(configured);
builder.Services.AddSingleton<ManifestVerifier>();
builder.Services.AddSingleton<ImmutableTargetPolicy>();
builder.Services.AddSingleton<IUpdateJournal>(_ => new FileUpdateJournal(configured.JournalPath));
builder.Services.AddSingleton<IUpdateResultStore>(_ => new FileUpdateResultStore(configured.ResultCachePath));
builder.Services.AddSingleton<IUpdateOutbox>(_ => new FileUpdateOutbox(configured.OutboxPath));
builder.Services.AddSingleton<IPendingUpdateCommandStore>(_ =>
  new FilePendingUpdateCommandStore(configured.PendingCommandPath));

builder.Services.AddHttpClient("broker", client =>
  client.BaseAddress = EnsureTrailingSlash(configured.BrokerBaseUri))
  .ConfigurePrimaryHttpMessageHandler(() => CreateMutualTlsHandler(configured));
builder.Services.AddHttpClient("health");
builder.Services.AddSingleton<IUpdateBrokerClient>(provider =>
  new UpdateBrokerClient(provider.GetRequiredService<IHttpClientFactory>().CreateClient("broker")));
builder.Services.AddSingleton<IUpdateArtifactProvider>(provider =>
  new HttpUpdateArtifactProvider(provider.GetRequiredService<IHttpClientFactory>().CreateClient("broker")));
builder.Services.AddSingleton<IUpdateHealthProbe>(provider =>
  new ConfiguredUpdateHealthProbe(provider.GetRequiredService<IHttpClientFactory>().CreateClient("health")));
builder.Services.AddSingleton<IUpdateTargetActivator, ConfiguredUpdateTargetActivator>();
builder.Services.AddSingleton<TrustedUpdateEngine>();
builder.Services.AddHostedService<UpdateSupervisorWorker>();

await builder.Build().RunAsync();

static void ValidateBootstrapConfiguration(UpdateSupervisorOptions options)
{
  if (!Guid.TryParse(options.DeviceId, out _) ||
      !Uri.TryCreate(options.BrokerBaseUri, UriKind.Absolute, out var broker) ||
      broker.Scheme != Uri.UriSchemeHttps ||
      options.BootstrapKeyId.Length is < 1 or > 128 ||
      options.PinnedBootstrapPublicKeySha256.Length != 64 ||
      string.IsNullOrWhiteSpace(options.EnrollmentId) !=
        string.IsNullOrWhiteSpace(options.EnrollmentCode) ||
      options.Targets.Count == 0)
    throw new InvalidOperationException("Trusted update supervisor configuration is invalid.");
  var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(options.SupervisorRoot));
  foreach (var trustedState in new[]
  {
    options.JournalPath,
    options.ResultCachePath,
    options.OutboxPath,
    options.PendingCommandPath,
    options.PinnedBootstrapPublicKeyPath,
  })
  {
    var path = Path.GetFullPath(trustedState);
    if (!path.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
      throw new InvalidOperationException("Update trust state must remain beneath the supervisor root.");
  }
  var supervisorParent = Directory.GetParent(root)?.FullName
    ?? throw new InvalidOperationException("The update supervisor root has no trusted parent.");
  var expectedKillSwitch = Path.GetFullPath(Path.Combine(supervisorParent, "DISABLED"));
  if (!string.Equals(Path.GetFullPath(options.KillSwitchPath), expectedKillSwitch,
        StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("The updater must use the shared trusted-root kill switch.");
}

static Uri EnsureTrailingSlash(string value) =>
  new(value.EndsWith('/') ? value : value + "/", UriKind.Absolute);

static HttpClientHandler CreateMutualTlsHandler(UpdateSupervisorOptions options)
{
  var thumbprint = options.ClientCertificateThumbprint.Replace(" ", string.Empty,
    StringComparison.Ordinal).ToUpperInvariant();
  using var store = new X509Store(StoreName.My, StoreLocation.LocalMachine);
  store.Open(OpenFlags.ReadOnly);
  var certificates = store.Certificates.Find(X509FindType.FindByThumbprint, thumbprint,
    validOnly: true);
  if (certificates.Count != 1 || !certificates[0].HasPrivateKey)
    throw new InvalidOperationException("Exactly one valid supervisor client certificate is required.");
  var handler = new HttpClientHandler();
  handler.ClientCertificates.Add(certificates[0]);
  handler.ClientCertificateOptions = ClientCertificateOption.Manual;
  return handler;
}
