using Itemba.Msaidizi.AuditSigner;
using Itemba.Msaidizi.AuditSigner.Channel;
using Itemba.Msaidizi.AuditSigner.Configuration;
using Itemba.Msaidizi.AuditSigner.Execution;
using Itemba.Msaidizi.AuditSigner.Journal;
using Itemba.Msaidizi.AuditSigner.Security;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options =>
  options.ServiceName = "Itemba Msaidizi Audit Signer");

var configured = builder.Configuration
  .GetSection(AuditSignerOptions.SectionName)
  .Get<AuditSignerOptions>()?.Expand()
  ?? throw new InvalidOperationException("Trusted audit signer configuration is missing.");
ValidateBootstrapConfiguration(configured);

var signer = HardwareBackedCertificateSigner.LoadFromLocalMachine(
  configured.ClientCertificateThumbprint,
  configured.HardwareKeyProvider);
builder.Services.AddSingleton(configured);
builder.Services.AddSingleton<IAuditCheckpointSigner>(signer);
builder.Services.AddSingleton<IAuditSignerJournal>(_ =>
  new FileAuditSignerJournal(configured.JournalPath));
builder.Services.AddHttpClient("audit-signer-broker", client =>
  client.BaseAddress = EnsureTrailingSlash(configured.BrokerBaseUri))
  .ConfigurePrimaryHttpMessageHandler(provider =>
  {
    var certificateSigner = provider.GetRequiredService<IAuditCheckpointSigner>();
    var handler = new HttpClientHandler
    {
      ClientCertificateOptions = ClientCertificateOption.Manual,
      ServerCertificateCustomValidationCallback = (_, certificate, _, errors) =>
        BrokerCertificatePinValidator.Validate(
          certificate,
          errors,
          configured.PinnedBrokerCertificateSha256,
          configured.PinnedBrokerSpkiSha256),
    };
    handler.ClientCertificates.Add(certificateSigner.Certificate);
    return handler;
  });
builder.Services.AddSingleton<IAuditSignerBrokerClient>(provider =>
  new AuditSignerBrokerClient(
    provider.GetRequiredService<IHttpClientFactory>().CreateClient("audit-signer-broker")));
builder.Services.AddSingleton<TrustedAuditSignerEngine>();
builder.Services.AddHostedService<AuditSignerWorker>();

await builder.Build().RunAsync().ConfigureAwait(false);

static void ValidateBootstrapConfiguration(AuditSignerOptions options)
{
  if (!Uri.TryCreate(options.BrokerBaseUri, UriKind.Absolute, out var broker) ||
      broker.Scheme != Uri.UriSchemeHttps ||
      !string.IsNullOrEmpty(broker.UserInfo) ||
      !string.IsNullOrEmpty(broker.Fragment) ||
      options.SignerKeyId.Length is < 1 or > 128 ||
      options.SignerKeyId.Any(character =>
        !(char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or '-')) ||
      !IsSha256(options.PinnedBrokerCertificateSha256) ||
      !IsSha256(options.PinnedBrokerSpkiSha256) ||
      string.Equals(
        options.PinnedBrokerCertificateSha256,
        options.PinnedBrokerSpkiSha256,
        StringComparison.Ordinal) ||
      string.IsNullOrWhiteSpace(options.ClientCertificateThumbprint) ||
      string.IsNullOrWhiteSpace(options.HardwareKeyProvider) ||
      options.MaxSegmentEvents is < 1 or > 1000 ||
      options.CheckpointTtlSeconds is < 30 or > 3600 ||
      options.PollIntervalSeconds is < 2 or > 300)
    throw new InvalidOperationException("Trusted audit signer configuration is invalid.");

  var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(options.SupervisorRoot));
  var journal = Path.GetFullPath(options.JournalPath);
  if (!journal.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("Audit signer journal must stay beneath its supervisor root.");
  var supervisorParent = Directory.GetParent(root)?.FullName
    ?? throw new InvalidOperationException("Audit signer root has no trusted supervisor parent.");
  var expectedKillSwitch = Path.GetFullPath(Path.Combine(supervisorParent, "DISABLED"));
  if (!string.Equals(
        Path.GetFullPath(options.KillSwitchPath),
        expectedKillSwitch,
        StringComparison.OrdinalIgnoreCase))
    throw new InvalidOperationException("Audit signer must use the shared trusted-root kill switch.");
}

static bool IsSha256(string value) =>
  value.Length == 64 && value.All(character =>
    character is >= '0' and <= '9' or >= 'a' and <= 'f');

static Uri EnsureTrailingSlash(string value) =>
  new(value.EndsWith('/') ? value : value + "/", UriKind.Absolute);
