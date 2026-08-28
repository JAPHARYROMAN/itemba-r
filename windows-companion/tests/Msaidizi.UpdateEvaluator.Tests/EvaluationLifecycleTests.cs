using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.UpdateEvaluator.Channel;
using Itemba.Msaidizi.UpdateEvaluator.Configuration;
using Itemba.Msaidizi.UpdateEvaluator.Contracts;
using Itemba.Msaidizi.UpdateEvaluator.Evaluation;
using Itemba.Msaidizi.UpdateEvaluator.Protocol;
using Itemba.Msaidizi.UpdateEvaluator.Review;
using Itemba.Msaidizi.UpdateEvaluator.Security;
using Itemba.Msaidizi.UpdateEvaluator.State;
using Xunit;

namespace Itemba.Msaidizi.UpdateEvaluator.Tests;

public sealed class EvaluationLifecycleTests : IDisposable
{
  private static readonly string[] ExpectedArtifactPurposes = ["SOURCE", "ROLLBACK", "REPORT"];

  private readonly string _root = Path.Combine(Path.GetTempPath(),
    "msaidizi-evaluator-lifecycle", Guid.NewGuid().ToString("N"));

  public EvaluationLifecycleTests() => Directory.CreateDirectory(_root);

  [Fact]
  public async Task LifecycleUsesExactLeaseArtifactsBudgetsAndTwoIndependentReviews()
  {
    var harness = Harness();

    var result = await harness.Engine.ExecuteAsync(harness.Lease, CancellationToken.None);

    Assert.Equal("APPROVED", result!.Status);
    Assert.Equal(ExpectedArtifactPurposes,
      harness.Broker.Artifacts.Select(item => item.Purpose));
    Assert.Equal(2, harness.Broker.LastHeartbeat!.ModelTurns);
    Assert.Equal("200", harness.Broker.LastHeartbeat.ModelInputTokens);
    Assert.Equal("40", harness.Broker.LastHeartbeat.ModelOutputTokens);
    Assert.Equal("2000", harness.Broker.LastHeartbeat.ModelCostMicrousd);
    Assert.Equal((harness.Broker.ManifestLength + 1_400).ToString(
      System.Globalization.CultureInfo.InvariantCulture),
      harness.Broker.LastHeartbeat.ExternalEgressBytes);
    Assert.Equal(2, harness.Broker.Reviews!.Count);
    Assert.All(harness.Broker.Reviews, review =>
      Assert.Equal(EvaluatorAttestationFactory.ClaimsDigest(harness.Broker.Runner!),
        JsonDocument.Parse(review.ClaimsJson).RootElement
          .GetProperty("runnerClaimsDigest").GetString()));
    Assert.Equal(1, harness.ReviewerA.Calls);
    Assert.Equal(1, harness.ReviewerB.Calls);
    Assert.Equal(1, harness.Vm.CleanupCalls);
    Assert.Equal("SUBMITTED_AND_CLEANED", harness.State.Read(harness.Lease.Id)!.TerminalStatus);
  }

  [Fact]
  public async Task CrashAfterAttestationReplaysSubmissionWithoutRerunningVmOrModels()
  {
    var harness = Harness();
    harness.Broker.FailFirstSubmission = true;
    await Assert.ThrowsAsync<HttpRequestException>(() =>
      harness.Engine.ExecuteAsync(harness.Lease, CancellationToken.None));
    Assert.Equal("ATTESTED", harness.State.Read(harness.Lease.Id)!.Stage);

    var result = await harness.Engine.ExecuteAsync(harness.Lease, CancellationToken.None);

    Assert.Equal("APPROVED", result!.Status);
    Assert.Equal(1, harness.Vm.PrepareCalls);
    Assert.Equal(1, harness.ReviewerA.Calls);
    Assert.Equal(1, harness.ReviewerB.Calls);
    Assert.Equal(3, harness.Broker.Artifacts.Count);
    Assert.Equal("SUBMITTED_AND_CLEANED", harness.State.Read(harness.Lease.Id)!.TerminalStatus);
  }

  [Fact]
  public async Task AuthorityCancellationInterruptsBothInFlightReviewsAndPreventsSubmission()
  {
    var harness = Harness(blockReviews: true, heartbeatSeconds: 1);
    harness.Broker.StopOnHeartbeat = 2;
    harness.Broker.StopCondition = () =>
      harness.ReviewerA.Calls == 1 && harness.ReviewerB.Calls == 1;

    await Assert.ThrowsAnyAsync<Exception>(() =>
      harness.Engine.ExecuteAsync(harness.Lease, CancellationToken.None));

    Assert.Equal(1, harness.ReviewerA.Cancellations);
    Assert.Equal(1, harness.ReviewerB.Cancellations);
    Assert.Equal(0, harness.Broker.Submissions);
  }

  [Fact]
  public async Task CompletedReviewIsHeartbeatedWhileIndependentPeerIsStillRunning()
  {
    var harness = Harness(blockOnlySecondReview: true, heartbeatSeconds: 1);
    harness.Broker.StopOnHeartbeat = 2;
    harness.Broker.StopCondition = () =>
      harness.ReviewerA.Calls == 1 && harness.ReviewerB.Calls == 1;

    await Assert.ThrowsAnyAsync<Exception>(() =>
      harness.Engine.ExecuteAsync(harness.Lease, CancellationToken.None));

    Assert.Contains(harness.Broker.Heartbeats, usage => usage.ModelTurns == 1 &&
      usage.ModelInputTokens == "100" && usage.ModelOutputTokens == "20" &&
      usage.ModelCostMicrousd == "1000" &&
      usage.ExternalEgressBytes == (harness.Broker.ManifestLength + 700).ToString(
        System.Globalization.CultureInfo.InvariantCulture));
    Assert.Equal(1, harness.ReviewerA.Calls);
    Assert.Equal(1, harness.ReviewerB.Cancellations);
    Assert.Equal(0, harness.Broker.Submissions);
  }

  public void Dispose()
  {
    if (Directory.Exists(_root)) Directory.Delete(_root, recursive: true);
  }

  private HarnessContext Harness(
    bool blockReviews = false,
    bool blockOnlySecondReview = false,
    int heartbeatSeconds = 30)
  {
    var helper = new BootstrapAndProtocolTests();
    var baseOptions = helper.Options();
    var options = new UpdateEvaluatorOptions
    {
      Enabled = true,
      BrokerBaseUri = baseOptions.BrokerBaseUri,
      TransportCertificateThumbprint = baseOptions.TransportCertificateThumbprint,
      PinnedBrokerCertificateSha256 = baseOptions.PinnedBrokerCertificateSha256,
      PinnedBrokerSpkiSha256 = baseOptions.PinnedBrokerSpkiSha256,
      EvaluatorRoot = _root,
      StatePath = Path.Combine(_root, "state"),
      TransferPath = Path.Combine(_root, "transfer"),
      KillSwitchPath = Path.Combine(_root, "supervisor", "DISABLED"),
      PollIntervalSeconds = 2,
      HeartbeatIntervalSeconds = heartbeatSeconds,
      AttestationTtlSeconds = 600,
      ProtectedPolicyVersion = baseOptions.ProtectedPolicyVersion,
      ProtectedPolicySha256 = baseOptions.ProtectedPolicySha256,
      ArtifactSigner = baseOptions.ArtifactSigner,
      RunnerSigner = baseOptions.RunnerSigner,
      Reviewers = baseOptions.Reviewers,
      HyperV = baseOptions.HyperV,
      Commands = baseOptions.Commands,
    };
    Directory.CreateDirectory(options.StatePath);
    Directory.CreateDirectory(options.TransferPath);
    var fileContent = Encoding.UTF8.GetBytes("const value = 1;\n");
    var manifestJson = BootstrapAndProtocolTests.ManifestJson(options,
      "frontend/src/value.ts", fileContent);
    var manifestBytes = Encoding.UTF8.GetBytes(manifestJson);
    var lease = BootstrapAndProtocolTests.Lease(options,
      GeneratedManifestValidator.Sha256(manifestBytes));
    var broker = new FakeBroker(manifestBytes);
    var vm = new FakeVm(_root, BootstrapAndProtocolTests.Hex('e'));
    var state = new MemoryStateStore();
    var artifactSigner = new MemorySigner("artifact-key");
    var runnerSigner = new MemorySigner("runner-key");
    var reviewerA = new FakeReviewer("reviewer-a", "model-a", blockReviews);
    var reviewerB = new FakeReviewer("reviewer-b", "model-b",
      blockReviews || blockOnlySecondReview);
    var registrations = new[]
    {
      new ReviewerRegistration(reviewerA, new MemorySigner("review-key-a")),
      new ReviewerRegistration(reviewerB, new MemorySigner("review-key-b")),
    };
    var engine = new UpdateEvaluationEngine(options, broker,
      new GeneratedManifestValidator(options), new EvaluatorAttestationFactory(options), vm, state,
      artifactSigner, runnerSigner, registrations, TimeProvider.System);
    helper.Dispose();
    return new(engine, lease, broker, vm, state, reviewerA, reviewerB);
  }

  private sealed record HarnessContext(
    UpdateEvaluationEngine Engine,
    EvaluationLease Lease,
    FakeBroker Broker,
    FakeVm Vm,
    MemoryStateStore State,
    FakeReviewer ReviewerA,
    FakeReviewer ReviewerB);

  private sealed class FakeBroker(byte[] manifest) : IEvaluationBrokerClient
  {
    public List<ArtifactDescriptor> Artifacts { get; } = [];
    public EvaluationUsageSnapshot? LastHeartbeat { get; private set; }
    public SignedAttestationEnvelope? Runner { get; private set; }
    public IReadOnlyList<SignedAttestationEnvelope>? Reviews { get; private set; }
    public bool FailFirstSubmission { get; set; }
    public int? StopOnHeartbeat { get; set; }
    public Func<bool>? StopCondition { get; set; }
    public int Submissions { get; private set; }
    public long ManifestLength => manifest.LongLength;
    public List<EvaluationUsageSnapshot> Heartbeats { get; } = [];
    private int _heartbeats;

    public Task<EvaluationLease?> PollAsync(CancellationToken cancellationToken) =>
      Task.FromResult<EvaluationLease?>(null);

    public Task StartAsync(EvaluationLease lease, CancellationToken cancellationToken) =>
      Task.CompletedTask;

    public Task<EvaluationHeartbeatResponse> HeartbeatAsync(
      EvaluationLease lease,
      EvaluationUsageSnapshot usage,
      CancellationToken cancellationToken)
    {
      LastHeartbeat = usage;
      Heartbeats.Add(usage);
      var heartbeatCount = Interlocked.Increment(ref _heartbeats);
      var stop = StopOnHeartbeat is { } threshold
        && heartbeatCount >= threshold
        && (StopCondition?.Invoke() ?? true);
      return Task.FromResult(new EvaluationHeartbeatResponse(!stop, stop,
        DateTimeOffset.UtcNow.AddMinutes(5), stop ? "TEST_AUTHORITY_REVOKED" : null));
    }

    public Task<GenerationArtifactPayload> DownloadGenerationArtifactAsync(
      EvaluationLease lease,
      CancellationToken cancellationToken) => Task.FromResult(new GenerationArtifactPayload(
        manifest.ToArray(), GeneratedManifestValidator.Sha256(manifest), manifest.LongLength,
        manifest.LongLength));

    public Task UploadArtifactAsync(
      ArtifactDescriptor artifact,
      CancellationToken cancellationToken)
    {
      if (Artifacts.All(item => item.Purpose != artifact.Purpose)) Artifacts.Add(artifact);
      return Task.CompletedTask;
    }

    public Task<EvaluationRunResult> SubmitAsync(
      string candidateId,
      SignedAttestationEnvelope runner,
      IReadOnlyList<SignedAttestationEnvelope> reviews,
      CancellationToken cancellationToken)
    {
      Submissions++;
      if (FailFirstSubmission)
      {
        FailFirstSubmission = false;
        throw new HttpRequestException("simulated delivery loss");
      }
      Runner = runner;
      Reviews = reviews;
      return Task.FromResult(new EvaluationRunResult(candidateId, "APPROVED",
        BootstrapAndProtocolTests.Hex('a'), false, false));
    }
  }

  private sealed class FakeVm(string root, string baseRevision) : IEvaluationVmProvider
  {
    public int PrepareCalls { get; private set; }
    public int CleanupCalls { get; private set; }
    private string Baseline(string runId) => Path.Combine(root, runId, "baseline");
    private string Working(string runId) => Path.Combine(root, runId, "working");

    public Task<VmEvaluationSession> PrepareAsync(
      EvaluationLease lease,
      CancellationToken cancellationToken)
    {
      PrepareCalls++;
      Directory.CreateDirectory(Baseline(lease.Id));
      File.WriteAllText(Path.Combine(Baseline(lease.Id), "README.md"), "baseline\n");
      CopyTree(Baseline(lease.Id), Working(lease.Id));
      return Task.FromResult(new VmEvaluationSession(lease.Id, "clean-windows-11", baseRevision,
        new Dictionary<string, string> { ["dotnet"] = "8.0.400" }, true, true));
    }

    public Task<MaterializationEvidence> MaterializeAsync(
      VmEvaluationSession session,
      GeneratedUpdateManifest manifest,
      ReadOnlyMemory<byte> canonicalManifest,
      CancellationToken cancellationToken)
    {
      long written = 0;
      foreach (var change in manifest.Changes)
      {
        var path = Path.Combine(Working(session.RunId), change.RelativePath.Replace('/',
          Path.DirectorySeparatorChar));
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var content = Convert.FromBase64String(change.ContentBase64!);
        File.WriteAllBytes(path, content);
        written += content.LongLength;
      }
      return Task.FromResult(new MaterializationEvidence(true, true,
        canonicalManifest.Length, written));
    }

    public Task<CheckExecutionEvidence> RunCheckAsync(
      VmEvaluationSession session,
      EvaluationCommandOptions command,
      CancellationToken cancellationToken) => Task.FromResult(new CheckExecutionEvidence(
        command.Check, 0, false, 1, 1, 1,
        BootstrapAndProtocolTests.Hex('1'), BootstrapAndProtocolTests.Hex('2'), string.Empty));

    public Task<ExportedWorkspace> ExportAsync(
      VmEvaluationSession session,
      string purpose,
      CancellationToken cancellationToken)
    {
      var path = purpose == "SOURCE" ? Working(session.RunId) : Baseline(session.RunId);
      var bytes = Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories)
        .Sum(file => new FileInfo(file).Length);
      return Task.FromResult(new ExportedWorkspace(path, bytes, bytes));
    }

    public Task CleanupAsync(VmEvaluationSession session, CancellationToken cancellationToken)
    {
      CleanupCalls++;
      return Task.CompletedTask;
    }

    private static void CopyTree(string source, string destination)
    {
      Directory.CreateDirectory(destination);
      foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
      {
        var target = Path.Combine(destination, Path.GetRelativePath(source, file));
        Directory.CreateDirectory(Path.GetDirectoryName(target)!);
        File.Copy(file, target, overwrite: true);
      }
    }
  }

  private sealed class FakeReviewer(string reviewerId, string modelId, bool block) :
    IIndependentReviewer
  {
    public string ReviewerId => reviewerId;
    public string ModelId => modelId;
    private int _calls;
    private int _cancellations;

    public int Calls => Volatile.Read(ref _calls);
    public int Cancellations => Volatile.Read(ref _cancellations);

    public async Task<ReviewerDecision> ReviewAsync(
      EvaluationBinding binding,
      string reportJson,
      string reportSha256,
      CancellationToken cancellationToken)
    {
      Interlocked.Increment(ref _calls);
      if (block)
      {
        try { await Task.Delay(Timeout.InfiniteTimeSpan, cancellationToken); }
        catch (OperationCanceledException)
        {
          Interlocked.Increment(ref _cancellations);
          throw;
        }
      }
      return new(reviewerId, modelId, "APPROVE", "All governed checks pass.",
        100, 20, 1_000, 500, 200);
    }
  }

  private sealed class MemorySigner : IAttestationSigner
  {
    private readonly ECDsa _key = ECDsa.Create(ECCurve.NamedCurves.nistP256);
    public MemorySigner(string keyId)
    {
      KeyId = keyId;
      SubjectPublicKeySha256 = GeneratedManifestValidator.Sha256(
        _key.ExportSubjectPublicKeyInfo());
    }
    public string KeyId { get; }
    public string SubjectPublicKeySha256 { get; }
    public SignedAttestationEnvelope Sign(object claims)
    {
      var json = CanonicalJson.Serialize(claims);
      var payload = Encoding.UTF8.GetBytes("MSAIDIZI-EVALUATOR-ATTESTATION-V1\0" + json);
      var signature = _key.SignData(payload, HashAlgorithmName.SHA256,
        DSASignatureFormat.IeeeP1363FixedFieldConcatenation);
      return new(json, EvaluatorSecurity.Base64Url(signature));
    }
    public void Dispose() => _key.Dispose();
  }

  private sealed class MemoryStateStore : IEvaluationStateStore
  {
    private readonly Dictionary<string, EvaluationCheckpoint> _values =
      new(StringComparer.OrdinalIgnoreCase);
    public IReadOnlyList<EvaluationCheckpoint> ReadPending() =>
      _values.Values.Where(value => value.TerminalStatus is null).ToArray();
    public EvaluationCheckpoint? Read(string runId) =>
      _values.TryGetValue(runId, out var value) ? value : null;
    public void Put(EvaluationCheckpoint checkpoint) =>
      _values[checkpoint.Lease.Id] = checkpoint;
    public void Complete(string runId, string terminalStatus) =>
      _values[runId] = _values[runId] with
      {
        Stage = "COMPLETED",
        TerminalStatus = terminalStatus,
      };
  }
}
