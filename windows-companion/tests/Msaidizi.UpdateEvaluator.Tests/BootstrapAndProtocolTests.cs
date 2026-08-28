using System.Security.Cryptography;
using System.Text;
using Itemba.Msaidizi.UpdateEvaluator.Configuration;
using Itemba.Msaidizi.UpdateEvaluator.Contracts;
using Itemba.Msaidizi.UpdateEvaluator.Protocol;
using Xunit;

namespace Itemba.Msaidizi.UpdateEvaluator.Tests;

public sealed class BootstrapAndProtocolTests : IDisposable
{
  private readonly string _root = Path.Combine(Path.GetTempPath(),
    "msaidizi-evaluator-tests", Guid.NewGuid().ToString("N"));

  public BootstrapAndProtocolTests()
  {
    Directory.CreateDirectory(Path.Combine(_root, "update-evaluator", "state"));
    Directory.CreateDirectory(Path.Combine(_root, "update-evaluator", "transfer"));
  }

  [Fact]
  public void StartupAcceptsOnlyFiveDistinctTrustIdentitiesAndTwoIndependentProviders()
  {
    var options = Options();
    UpdateEvaluatorBootstrapValidator.ValidateShape(options);
    UpdateEvaluatorBootstrapValidator.ValidateIdentityFingerprints(
      Hex('1'), Hex('2'), Hex('3'), [Hex('4'), Hex('5')]);

    Assert.Throws<InvalidOperationException>(() =>
      UpdateEvaluatorBootstrapValidator.ValidateIdentityFingerprints(
        Hex('1'), Hex('2'), Hex('3'), [Hex('3'), Hex('5')]));
  }

  [Theory]
  [InlineData("provider")]
  [InlineData("origin")]
  [InlineData("credential")]
  [InlineData("reviewer")]
  [InlineData("model")]
  [InlineData("key")]
  [InlineData("certificate")]
  public void StartupRejectsEveryReviewerIdentityReuse(string reused)
  {
    var first = Reviewer("provider-a", "reviewer-a", "model-a",
      "https://review-a.example/v1/review", "REVIEWER_A_KEY", "review-key-a", "AA11");
    var second = Reviewer(
      reused == "provider" ? first.ProviderId : "provider-b",
      reused == "reviewer" ? first.ReviewerId : "reviewer-b",
      reused == "model" ? first.ModelId : "model-b",
      reused == "origin" ? "https://review-a.example/v2/review" :
        "https://review-b.example/v1/review",
      reused == "credential" ? first.ApiKeyEnvironmentVariable : "REVIEWER_B_KEY",
      reused == "key" ? first.Signer.KeyId : "review-key-b",
      reused == "certificate" ? first.Signer.CertificateThumbprint : "BB22");

    Assert.Throws<InvalidOperationException>(() =>
      UpdateEvaluatorBootstrapValidator.ValidateShape(Options([first, second])));
  }

  [Fact]
  public void ManifestPinsCanonicalBytesBudgetPolicyAndAuthorizedPaths()
  {
    var options = Options();
    var content = Encoding.UTF8.GetBytes("const value = 1;\n");
    var manifestJson = ManifestJson(options, "frontend/src/value.ts", content);
    var bytes = Encoding.UTF8.GetBytes(manifestJson);
    var lease = Lease(options, GeneratedManifestValidator.Sha256(bytes));

    var parsed = new GeneratedManifestValidator(options).Validate(lease, bytes);

    Assert.Equal("frontend/src/value.ts", parsed.Changes.Single().RelativePath);
    Assert.Throws<EvaluationProtocolException>(() =>
      new GeneratedManifestValidator(options).Validate(lease,
        Encoding.UTF8.GetBytes(manifestJson + " ")));
  }

  [Theory]
  [InlineData("../escape.ts")]
  [InlineData("frontend/src/file.ts:stream")]
  [InlineData("windows-companion/src/Msaidizi.UpdateEvaluator/Program.cs")]
  [InlineData("backend/src/modules/msaidizi-updates/unsafe.ts")]
  [InlineData("frontend/src/update-supervisor.ts")]
  public void ManifestRefusesTraversalAdsAndSupervisorBoundary(string path)
  {
    var options = Options();
    var content = Encoding.UTF8.GetBytes("safe\n");
    var bytes = Encoding.UTF8.GetBytes(ManifestJson(options, path, content));
    var lease = Lease(options, GeneratedManifestValidator.Sha256(bytes));

    Assert.Throws<EvaluationProtocolException>(() =>
      new GeneratedManifestValidator(options).Validate(lease, bytes));
  }

  [Fact]
  public void UsageIsCumulativeAndFailsBeforeExceedingAnyHardBudget()
  {
    var budget = EvaluationBudget.Parse(Budgets() with { MaxBytesWritten = "10" });
    var meter = new EvaluationUsageMeter(budget);
    meter.AddLocal(written: 7);

    Assert.Throws<EvaluationProtocolException>(() => meter.AddLocal(written: 4));
    Assert.Equal("7", meter.Snapshot().BytesWritten);
  }

  public void Dispose()
  {
    if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
  }

  internal UpdateEvaluatorOptions Options(IReadOnlyList<ReviewerOptions>? reviewers = null) => new()
  {
    Enabled = true,
    BrokerBaseUri = "https://broker.example/msaidizi/update-verifier/",
    TransportCertificateThumbprint = "0011",
    PinnedBrokerCertificateSha256 = Hex('a'),
    PinnedBrokerSpkiSha256 = Hex('b'),
    EvaluatorRoot = Path.Combine(_root, "update-evaluator"),
    StatePath = Path.Combine(_root, "update-evaluator", "state"),
    TransferPath = Path.Combine(_root, "update-evaluator", "transfer"),
    KillSwitchPath = Path.Combine(_root, "supervisor", "DISABLED"),
    PollIntervalSeconds = 10,
    HeartbeatIntervalSeconds = 30,
    AttestationTtlSeconds = 600,
    ProtectedPolicyVersion = "msaidizi-generated-update-policy/v1",
    ProtectedPolicySha256 = Hex('f'),
    ArtifactSigner = Signer("artifact-key", "2233"),
    RunnerSigner = Signer("runner-key", "4455"),
    Reviewers = reviewers ??
    [
      Reviewer("provider-a", "reviewer-a", "model-a",
        "https://review-a.example/v1/review", "REVIEWER_A_KEY", "review-key-a", "6677"),
      Reviewer("provider-b", "reviewer-b", "model-b",
        "https://review-b.example/v1/review", "REVIEWER_B_KEY", "review-key-b", "8899"),
    ],
    HyperV = new()
    {
      VmName = "Msaidizi-Evaluation",
      CleanSnapshotName = "clean",
      CleanSnapshotId = "clean-windows-11",
      GuestCredentialPath = Path.Combine(_root, "guest.credential.xml"),
      ProviderScriptPath = Path.Combine(_root, "provider.ps1"),
      ProviderScriptSha256 = Hex('c'),
      PowerShellExecutablePath = Path.Combine(Environment.SystemDirectory,
        "WindowsPowerShell", "v1.0", "power" + "shell.exe"),
      VmReadyTimeoutSeconds = 180,
      ProviderOperationTimeoutSeconds = 900,
    },
    Commands =
    [
      new() { Check = "TESTS", FileName = "npm.cmd" },
      new() { Check = "STATIC_ANALYSIS", FileName = "npm.cmd" },
      new() { Check = "ADVERSARIAL", FileName = "npm.cmd" },
    ],
  };

  internal static EvaluationLease Lease(UpdateEvaluatorOptions options, string manifestSha) => new(
    "11111111-1111-4111-8111-111111111111",
    "evaluation-run-1",
    "22222222-2222-4222-8222-222222222222",
    "33333333-3333-4333-8333-333333333333",
    "44444444-4444-4444-8444-444444444444",
    "55555555-5555-4555-8555-555555555555",
    Hex('d'),
    "66666666-6666-4666-8666-666666666666",
    manifestSha,
    options.ProtectedPolicyVersion,
    options.ProtectedPolicySha256,
    new Dictionary<string, bool>
    {
      ["isolatedWindowsVm"] = true,
      ["baseRevisionMatch"] = true,
      ["tests"] = true,
      ["staticAnalysis"] = true,
      ["adversarialEvaluation"] = true,
      ["supervisorIntegrity"] = true,
      ["protectedBoundaryDiff"] = true,
      ["ntfsReparseHardLinkAndToctouIsolation"] = true,
      ["dualIndependentModelReview"] = true,
    },
    Budgets(),
    "77777777-7777-4777-8777-777777777777",
    1,
    DateTimeOffset.UtcNow.AddMinutes(5));

  internal static string ManifestJson(
    UpdateEvaluatorOptions options,
    string relativePath,
    byte[] content) => CanonicalJson.Serialize(new
    {
      protocol = options.ProtectedPolicyVersion,
      taskId = "33333333-3333-4333-8333-333333333333",
      planVersionId = "44444444-4444-4444-8444-444444444444",
      stepId = "55555555-5555-4555-8555-555555555555",
      attemptId = "88888888-8888-4888-8888-888888888888",
      name = "Safe candidate",
      version = "1.0.1",
      rollbackVersion = "1.0.0",
      scope = "APPLICATION",
      rationale = "Measured regression closure",
      baseRevisionSha256 = Hex('e'),
      changes = new[]
      {
        new
        {
          relativePath,
          operation = "ADD",
          expectedPreSha256 = (string?)null,
          contentBase64 = Convert.ToBase64String(content),
          contentSha256 = GeneratedManifestValidator.Sha256(content),
        },
      },
      evaluationBudget = Budgets(),
      protectedSupervisorBoundary = "EXCLUDED",
      protectedPathPolicyVersion = options.ProtectedPolicyVersion,
      protectedPathPolicySha256 = options.ProtectedPolicySha256,
    });

  internal static EvaluationBudgets Budgets() => new(
    600, 600, "100000000", "100000000", "100000000", 4,
    "100000", "100000", "10000000");

  internal static ReviewerOptions Reviewer(
    string provider,
    string reviewer,
    string model,
    string endpoint,
    string credential,
    string key,
    string thumbprint) => new()
    {
      ProviderId = provider,
      ReviewerId = reviewer,
      ModelId = model,
      Endpoint = endpoint,
      PinnedServerSpkiSha256 = Hex(provider == "provider-a" ? '1' : '2'),
      ApiKeyEnvironmentVariable = credential,
      Signer = Signer(key, thumbprint),
    };

  internal static AttestationSignerOptions Signer(string key, string thumbprint) => new()
  {
    KeyId = key,
    CertificateThumbprint = thumbprint,
    HardwareKeyProvider = "Microsoft Platform Crypto Provider",
  };

  internal static string Hex(char value) => new(value, 64);
}
