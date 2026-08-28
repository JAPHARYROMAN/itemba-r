using Itemba.Msaidizi.UpdateEvaluator;
using Itemba.Msaidizi.UpdateEvaluator.Channel;
using Itemba.Msaidizi.UpdateEvaluator.Configuration;
using Itemba.Msaidizi.UpdateEvaluator.Evaluation;
using Itemba.Msaidizi.UpdateEvaluator.Protocol;
using Itemba.Msaidizi.UpdateEvaluator.Review;
using Itemba.Msaidizi.UpdateEvaluator.Security;
using Itemba.Msaidizi.UpdateEvaluator.State;

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddWindowsService(options =>
  options.ServiceName = "Itemba Msaidizi Update Evaluator");

var configured = builder.Configuration.GetSection(UpdateEvaluatorOptions.SectionName)
  .Get<UpdateEvaluatorOptions>()?.Expand()
  ?? throw new InvalidOperationException("Update evaluator configuration is missing.");
builder.Services.AddSingleton(configured);
if (!configured.Enabled)
{
  builder.Services.AddHostedService<DisabledUpdateEvaluatorWorker>();
  await builder.Build().RunAsync().ConfigureAwait(false);
  return;
}

UpdateEvaluatorBootstrapValidator.ValidateShape(configured);
var transport = EvaluatorTransportIdentity.Load(configured.TransportCertificateThumbprint);
var artifactSigner = CertificateAttestationSigner.Load(configured.ArtifactSigner);
var runnerSigner = CertificateAttestationSigner.Load(configured.RunnerSigner);
var reviewSigners = configured.Reviewers.Select(reviewer =>
  CertificateAttestationSigner.Load(reviewer.Signer)).ToArray();
UpdateEvaluatorBootstrapValidator.ValidateIdentityFingerprints(
  transport.SubjectPublicKeySha256,
  artifactSigner.SubjectPublicKeySha256,
  runnerSigner.SubjectPublicKeySha256,
  reviewSigners.Select(signer => signer.SubjectPublicKeySha256));

builder.Services.AddSingleton(transport);
builder.Services.AddSingleton(artifactSigner);
builder.Services.AddSingleton(runnerSigner);
foreach (var signer in reviewSigners) builder.Services.AddSingleton(signer);
builder.Services.AddHttpClient("evaluator-broker", client =>
  client.BaseAddress = EnsureTrailingSlash(configured.BrokerBaseUri))
  .ConfigurePrimaryHttpMessageHandler(() =>
  {
    var handler = new HttpClientHandler
    {
      ClientCertificateOptions = ClientCertificateOption.Manual,
      ServerCertificateCustomValidationCallback = (_, certificate, _, errors) =>
        EvaluatorSecurity.ValidatePinnedBrokerCertificate(
          certificate,
          errors,
          configured.PinnedBrokerCertificateSha256,
          configured.PinnedBrokerSpkiSha256),
    };
    handler.ClientCertificates.Add(transport.Certificate);
    return handler;
  });
for (var index = 0; index < configured.Reviewers.Count; index++)
{
  var reviewer = configured.Reviewers[index];
  builder.Services.AddHttpClient($"evaluator-reviewer-{index}")
    .ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
    {
      ServerCertificateCustomValidationCallback = (_, certificate, _, errors) =>
        EvaluatorSecurity.ValidatePinnedServerSpki(
          certificate, errors, reviewer.PinnedServerSpkiSha256),
    });
}

builder.Services.AddSingleton<IEvaluationBrokerClient>(provider =>
  new EvaluationBrokerClient(provider.GetRequiredService<IHttpClientFactory>()
    .CreateClient("evaluator-broker")));
builder.Services.AddSingleton<IStateProtector, WindowsMachineStateProtector>();
builder.Services.AddSingleton<IEvaluationStateStore>(provider =>
  new FileEvaluationStateStore(configured.StatePath,
    provider.GetRequiredService<IStateProtector>()));
builder.Services.AddSingleton<GeneratedManifestValidator>();
builder.Services.AddSingleton<EvaluatorAttestationFactory>();
builder.Services.AddSingleton<IEvaluationVmProvider, HyperVPowerShellEvaluationProvider>();
builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddSingleton<IReadOnlyList<ReviewerRegistration>>(provider =>
  configured.Reviewers.Select((reviewer, index) => new ReviewerRegistration(
    new HttpIndependentReviewer(
      provider.GetRequiredService<IHttpClientFactory>().CreateClient($"evaluator-reviewer-{index}"),
      reviewer),
    reviewSigners[index])).ToArray());
builder.Services.AddSingleton(provider => new UpdateEvaluationEngine(
  configured,
  provider.GetRequiredService<IEvaluationBrokerClient>(),
  provider.GetRequiredService<GeneratedManifestValidator>(),
  provider.GetRequiredService<EvaluatorAttestationFactory>(),
  provider.GetRequiredService<IEvaluationVmProvider>(),
  provider.GetRequiredService<IEvaluationStateStore>(),
  artifactSigner,
  runnerSigner,
  provider.GetRequiredService<IReadOnlyList<ReviewerRegistration>>(),
  provider.GetRequiredService<TimeProvider>()));
builder.Services.AddHostedService<UpdateEvaluatorWorker>();

await builder.Build().RunAsync().ConfigureAwait(false);

static Uri EnsureTrailingSlash(string value) =>
  new(value.EndsWith('/') ? value : value + "/", UriKind.Absolute);
