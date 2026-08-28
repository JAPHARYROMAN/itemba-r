using System.Security.Cryptography;
using System.Globalization;
using System.Text;
using System.Text.Json;
using Itemba.Msaidizi.UpdateEvaluator.Channel;
using Itemba.Msaidizi.UpdateEvaluator.Configuration;
using Itemba.Msaidizi.UpdateEvaluator.Contracts;
using Itemba.Msaidizi.UpdateEvaluator.Protocol;
using Itemba.Msaidizi.UpdateEvaluator.Review;
using Itemba.Msaidizi.UpdateEvaluator.Security;
using Itemba.Msaidizi.UpdateEvaluator.State;

namespace Itemba.Msaidizi.UpdateEvaluator.Evaluation;

public sealed record ReviewerRegistration(
  IIndependentReviewer Reviewer,
  IAttestationSigner Signer);

public sealed class EvaluationAuthorityLostException(string code) : InvalidOperationException(code)
{
  public string Code { get; } = code;
}

public sealed class UpdateEvaluationEngine(
  UpdateEvaluatorOptions options,
  IEvaluationBrokerClient broker,
  GeneratedManifestValidator manifestValidator,
  EvaluatorAttestationFactory attestations,
  IEvaluationVmProvider vm,
  IEvaluationStateStore state,
  IAttestationSigner artifactSigner,
  IAttestationSigner runnerSigner,
  IReadOnlyList<ReviewerRegistration> reviewers,
  TimeProvider timeProvider)
{
  private readonly string _transferRoot =
    Path.TrimEndingDirectorySeparator(Path.GetFullPath(options.TransferPath));

  public async Task<EvaluationRunResult?> ExecuteAsync(
    EvaluationLease lease,
    CancellationToken cancellationToken)
  {
    manifestValidator.AssertLease(lease);
    var checkpoint = state.Read(lease.Id) ?? NewCheckpoint(lease);
    AssertCheckpointBinding(checkpoint, lease);
    if (checkpoint.TerminalStatus is not null) return null;
    if (checkpoint.Stage == "SUBMITTED")
    {
      await CleanupSubmittedAsync(checkpoint, cancellationToken).ConfigureAwait(false);
      return null;
    }
    if (File.Exists(options.KillSwitchPath))
      throw new EvaluationAuthorityLostException("EVALUATOR_GLOBAL_KILL_SWITCH");

    var budget = EvaluationBudget.Parse(lease.Budgets);
    var meter = new EvaluationUsageMeter(budget, checkpoint.LastUsage);
    var hardDeadline = checkpoint.StartedAt.AddSeconds(budget.MaxWallTimeSeconds);
    using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
    var remaining = hardDeadline - timeProvider.GetUtcNow();
    if (remaining <= TimeSpan.Zero)
      throw new EvaluationAuthorityLostException("EVALUATOR_WALL_TIME_EXCEEDED");
    deadline.CancelAfter(remaining);
    using var heartbeatStop = new CancellationTokenSource();
    using var heartbeatLifetime = CancellationTokenSource.CreateLinkedTokenSource(
      heartbeatStop.Token, cancellationToken);
    using var authority = CancellationTokenSource.CreateLinkedTokenSource(deadline.Token);
    using var controlPlane = new SemaphoreSlim(1, 1);

    await broker.StartAsync(lease, authority.Token).ConfigureAwait(false);
    await SendHeartbeatAsync(lease, meter, controlPlane, authority.Token).ConfigureAwait(false);
    var heartbeat = PumpHeartbeatsAsync(lease, meter, controlPlane, authority,
      heartbeatLifetime.Token);
    VmEvaluationSession? session = null;
    byte[]? generationContent = null;
    try
    {
      if (checkpoint.Stage == "ATTESTED")
      {
        var replay = await SubmitAttestedAsync(checkpoint, controlPlane, authority.Token)
          .ConfigureAwait(false);
        checkpoint = checkpoint with { Stage = "SUBMITTED" };
        state.Put(checkpoint);
        await CleanupSubmittedAsync(checkpoint, authority.Token).ConfigureAwait(false);
        return replay;
      }

      GenerationArtifactPayload generation;
      await controlPlane.WaitAsync(authority.Token).ConfigureAwait(false);
      try
      {
        generation = await broker.DownloadGenerationArtifactAsync(lease, authority.Token)
          .ConfigureAwait(false);
        if (!GeneratedManifestValidator.FixedHex(generation.Sha256,
              lease.GenerationArtifactSha256))
          throw new EvaluationProtocolException("EVALUATOR_GENERATION_HEADER_DIGEST_MISMATCH");
        meter.RaiseIoFloor(generation.BytesReadFloor, generation.ExternalEgressBytesFloor);
      }
      finally { controlPlane.Release(); }
      generationContent = generation.Content;
      var manifest = manifestValidator.Validate(lease, generationContent);
      checkpoint = Save(checkpoint with { Stage = "MANIFEST_VALIDATED" }, meter);

      session = await vm.PrepareAsync(lease, authority.Token).ConfigureAwait(false);
      AssertSession(session, lease);
      checkpoint = Save(checkpoint with { Stage = "VM_PREPARED" }, meter);
      var materialized = await vm.MaterializeAsync(session, manifest, generation.Content,
        authority.Token).ConfigureAwait(false);
      meter.AddLocal(materialized.BytesRead, materialized.BytesWritten);

      var commandEvidence = new List<CheckExecutionEvidence>();
      foreach (var command in ValidatedCommands())
      {
        var evidence = await vm.RunCheckAsync(session, command, authority.Token)
          .ConfigureAwait(false);
        if (evidence.Check != command.Check ||
            !GeneratedManifestValidator.IsSha256(evidence.StdoutSha256) ||
            !GeneratedManifestValidator.IsSha256(evidence.StderrSha256))
          throw new EvaluationProtocolException("EVALUATOR_COMMAND_EVIDENCE_INVALID");
        meter.AddLocal(evidence.BytesRead, evidence.BytesWritten, evidence.CpuTimeSeconds);
        commandEvidence.Add(evidence with { OutputExcerpt = string.Empty });
        checkpoint = Save(checkpoint with { Stage = "CHECK_RUNNING" }, meter);
      }
      var checks = BuildChecks(session, manifest, materialized, commandEvidence);

      var rollbackExport = await vm.ExportAsync(session, "ROLLBACK", authority.Token)
        .ConfigureAwait(false);
      meter.AddLocal(rollbackExport.BytesRead, rollbackExport.BytesWritten);
      var sourceExport = await vm.ExportAsync(session, "SOURCE", authority.Token)
        .ConfigureAwait(false);
      meter.AddLocal(sourceExport.BytesRead, sourceExport.BytesWritten);
      var runRoot = OwnedRunRoot(lease.Id);
      Directory.CreateDirectory(runRoot);
      var rollbackPath = Path.Combine(runRoot, "rollback.zip");
      var sourcePath = Path.Combine(runRoot, "source.zip");
      var rollbackArchive = DeterministicArchive.Create(rollbackExport.DirectoryPath, rollbackPath);
      meter.AddLocal(rollbackArchive.SourceBytes, rollbackArchive.ByteSize);
      var sourceArchive = DeterministicArchive.Create(sourceExport.DirectoryPath, sourcePath);
      meter.AddLocal(sourceArchive.SourceBytes, sourceArchive.ByteSize);

      var reportJson = BuildReport(lease, manifest, session, checks, materialized, commandEvidence,
        sourceArchive.Sha256, rollbackArchive.Sha256);
      var reportPath = Path.Combine(runRoot, "evaluation-report.json");
      var reportBytes = Encoding.UTF8.GetBytes(reportJson);
      await File.WriteAllBytesAsync(reportPath, reportBytes, authority.Token).ConfigureAwait(false);
      var reportSha256 = GeneratedManifestValidator.Sha256(reportBytes);
      meter.AddLocal(written: reportBytes.LongLength);
      CryptographicOperations.ZeroMemory(reportBytes);

      var artifactDescriptors = CreateArtifacts(checkpoint, lease, manifest, session,
        sourcePath, sourceArchive.ByteSize, sourceArchive.Sha256,
        rollbackPath, rollbackArchive.ByteSize, rollbackArchive.Sha256,
        reportPath, new FileInfo(reportPath).Length, reportSha256);
      checkpoint = checkpoint with
      {
        Stage = "ARTIFACTS_SIGNED",
        ArtifactAttestations = artifactDescriptors.ToDictionary(
          item => item.Purpose, item => item.Attestation, StringComparer.Ordinal),
      };
      checkpoint = Save(checkpoint, meter);

      foreach (var artifact in artifactDescriptors)
      {
        if (checkpoint.UploadedArtifactPurposes.Contains(artifact.Purpose, StringComparer.Ordinal))
          continue;
        await controlPlane.WaitAsync(authority.Token).ConfigureAwait(false);
        try
        {
          await broker.UploadArtifactAsync(artifact, authority.Token).ConfigureAwait(false);
          // The broker reserves the encrypted trusted artifact in the same run's
          // bytes-written counter. Add it while heartbeats are excluded so the
          // next cumulative report can never move that authoritative counter back.
          meter.AddLocal(written: artifact.ByteSize);
          checkpoint = checkpoint with
          {
            UploadedArtifactPurposes = checkpoint.UploadedArtifactPurposes
              .Append(artifact.Purpose).Distinct(StringComparer.Ordinal).ToArray(),
          };
          checkpoint = Save(checkpoint, meter);
        }
        finally { controlPlane.Release(); }
      }

      var binding = new EvaluationBinding(
        lease.CandidateId, lease.TaskId, lease.PlanVersionId, lease.StepId,
        artifactDescriptors.Single(item => item.Purpose == "SOURCE").ArtifactId,
        sourceArchive.Sha256,
        artifactDescriptors.Single(item => item.Purpose == "ROLLBACK").ArtifactId,
        rollbackArchive.Sha256, manifest.RollbackVersion,
        artifactDescriptors.Single(item => item.Purpose == "REPORT").ArtifactId,
        reportSha256, lease.EvaluationRunId, session.CleanSnapshotId,
        session.ToolchainVersions, lease.RequestDigest, lease.GenerationArtifactId,
        lease.GenerationArtifactSha256, lease.GenerationArtifactSha256,
        options.ProtectedPolicyVersion, options.ProtectedPolicySha256,
        manifest.BaseRevisionSha256);

      var decisions = checkpoint.ReviewerDecisions.ToList();
      var missingReviews = reviewers.Where(registration =>
        decisions.All(decision => decision.ReviewerId != registration.Reviewer.ReviewerId))
        .ToArray();
      using var reviewCancellation = CancellationTokenSource.CreateLinkedTokenSource(authority.Token);
      var pendingReviews = missingReviews.Select(registration => new PendingReview(
        registration,
        registration.Reviewer.ReviewAsync(
          binding, reportJson, reportSha256, reviewCancellation.Token))).ToList();
      try
      {
        while (pendingReviews.Count > 0)
        {
          var completedTask = await Task.WhenAny(pendingReviews.Select(item => item.Task))
            .ConfigureAwait(false);
          var completed = pendingReviews.Single(item => item.Task == completedTask);
          var decision = await completedTask.ConfigureAwait(false);
          if (decision.ReviewerId != completed.Registration.Reviewer.ReviewerId ||
              decision.ModelId != completed.Registration.Reviewer.ModelId)
            throw new EvaluationProtocolException("EVALUATOR_REVIEW_IDENTITY_MISMATCH");
          meter.AddModelTurn(decision.InputTokens, decision.OutputTokens, decision.CostMicrousd,
            checked(decision.RequestBytes + decision.ResponseBytes));
          decisions.Add(decision);
          checkpoint = checkpoint with { ReviewerDecisions = decisions.ToArray() };
          checkpoint = Save(checkpoint, meter);
          pendingReviews.Remove(completed);
        }
      }
      catch
      {
        reviewCancellation.Cancel();
        try
        {
          await Task.WhenAll(pendingReviews.Select(item => item.Task)).ConfigureAwait(false);
        }
        catch
        {
          // Preserve the first review/authority failure after observing every peer task.
        }
        throw;
      }
      AssertIndependentReviews(decisions);

      heartbeatStop.Cancel();
      await ObserveHeartbeatStopAsync(heartbeat).ConfigureAwait(false);
      await SendHeartbeatAsync(lease, meter, controlPlane, authority.Token).ConfigureAwait(false);
      var finalUsage = meter.Snapshot();
      var now = timeProvider.GetUtcNow();
      var failures = FailureCodes(checks);
      var runner = attestations.Runner(runnerSigner, binding, lease, checks, finalUsage, failures, now);
      var runnerDigest = EvaluatorAttestationFactory.ClaimsDigest(runner);
      var reviewAttestations = decisions.OrderBy(decision => decision.ReviewerId, StringComparer.Ordinal)
        .Select(decision =>
        {
          var registration = reviewers.Single(item =>
            item.Reviewer.ReviewerId == decision.ReviewerId);
          return attestations.Review(registration.Signer, binding, lease, finalUsage, decision,
            runnerDigest, now);
        }).ToArray();
      checkpoint = checkpoint with
      {
        Stage = "ATTESTED",
        RunnerAttestation = runner,
        ReviewAttestations = reviewAttestations,
        LastUsage = finalUsage,
      };
      state.Put(checkpoint);
      var result = await broker.SubmitAsync(lease.CandidateId, runner, reviewAttestations,
        authority.Token).ConfigureAwait(false);
      checkpoint = checkpoint with { Stage = "SUBMITTED" };
      state.Put(checkpoint);
      return result;
    }
    finally
    {
      heartbeatStop.Cancel();
      await ObserveHeartbeatStopAsync(heartbeat).ConfigureAwait(false);
      try
      {
        if (session is not null)
        {
          using var cleanup = new CancellationTokenSource(TimeSpan.FromSeconds(
            options.HyperV.ProviderOperationTimeoutSeconds));
          try
          {
            await vm.CleanupAsync(session, cleanup.Token).ConfigureAwait(false);
            var current = state.Read(lease.Id);
            if (current?.Stage == "SUBMITTED") state.Complete(lease.Id, "SUBMITTED_AND_CLEANED");
          }
          catch when (state.Read(lease.Id)?.Stage != "SUBMITTED")
          {
            // Preserve the primary evaluation error. A non-submitted run remains
            // recoverable and cleanup is retried before any later evaluation.
          }
        }
      }
      finally
      {
        if (generationContent is not null)
          CryptographicOperations.ZeroMemory(generationContent);
      }
    }
  }

  private EvaluationCheckpoint NewCheckpoint(EvaluationLease lease)
  {
    var checkpoint = new EvaluationCheckpoint(
      lease, "LEASED", timeProvider.GetUtcNow(),
      new(0, "0", "0", "0", 0, "0", "0", "0"),
      new Dictionary<string, SignedAttestationEnvelope>(StringComparer.Ordinal),
      [], [], null, [], null);
    state.Put(checkpoint);
    return checkpoint;
  }

  private EvaluationCheckpoint Save(EvaluationCheckpoint checkpoint, EvaluationUsageMeter meter)
  {
    checkpoint = checkpoint with { LastUsage = meter.Snapshot() };
    state.Put(checkpoint);
    return checkpoint;
  }

  private async Task<EvaluationRunResult> SubmitAttestedAsync(
    EvaluationCheckpoint checkpoint,
    SemaphoreSlim controlPlane,
    CancellationToken cancellationToken)
  {
    if (checkpoint.RunnerAttestation is null || checkpoint.ReviewAttestations.Count != 2)
      throw new InvalidDataException("Attested evaluator checkpoint is incomplete.");
    await controlPlane.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var heartbeat = await broker.HeartbeatAsync(checkpoint.Lease, checkpoint.LastUsage,
        cancellationToken).ConfigureAwait(false);
      if (!heartbeat.Accepted || heartbeat.Stop)
        throw new EvaluationAuthorityLostException(
          heartbeat.FailureCode ?? "EVALUATOR_AUTHORITY_REVOKED");
      return await broker.SubmitAsync(checkpoint.Lease.CandidateId,
        checkpoint.RunnerAttestation, checkpoint.ReviewAttestations, cancellationToken)
        .ConfigureAwait(false);
    }
    finally { controlPlane.Release(); }
  }

  private async Task CleanupSubmittedAsync(
    EvaluationCheckpoint checkpoint,
    CancellationToken cancellationToken)
  {
    var session = new VmEvaluationSession(checkpoint.Lease.Id, options.HyperV.CleanSnapshotId,
      string.Empty, new Dictionary<string, string>(), true, false);
    await vm.CleanupAsync(session, cancellationToken).ConfigureAwait(false);
    state.Complete(checkpoint.Lease.Id, "SUBMITTED_AND_CLEANED");
  }

  private async Task PumpHeartbeatsAsync(
    EvaluationLease lease,
    EvaluationUsageMeter meter,
    SemaphoreSlim controlPlane,
    CancellationTokenSource authority,
    CancellationToken cancellationToken)
  {
    try
    {
      while (true)
      {
        await Task.Delay(TimeSpan.FromSeconds(options.HeartbeatIntervalSeconds), cancellationToken)
          .ConfigureAwait(false);
        if (File.Exists(options.KillSwitchPath))
          throw new EvaluationAuthorityLostException("EVALUATOR_GLOBAL_KILL_SWITCH");
        await SendHeartbeatAsync(lease, meter, controlPlane, cancellationToken).ConfigureAwait(false);
      }
    }
    catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
    {
      // Normal engine shutdown.
    }
    catch
    {
      authority.Cancel();
      throw;
    }
  }

  private async Task SendHeartbeatAsync(
    EvaluationLease lease,
    EvaluationUsageMeter meter,
    SemaphoreSlim controlPlane,
    CancellationToken cancellationToken)
  {
    await controlPlane.WaitAsync(cancellationToken).ConfigureAwait(false);
    try
    {
      var response = await broker.HeartbeatAsync(lease, meter.Snapshot(), cancellationToken)
        .ConfigureAwait(false);
      if (!response.Accepted || response.Stop)
        throw new EvaluationAuthorityLostException(
          response.FailureCode ?? "EVALUATOR_AUTHORITY_REVOKED");
    }
    finally { controlPlane.Release(); }
  }

  private static async Task ObserveHeartbeatStopAsync(Task heartbeat)
  {
    try { await heartbeat.ConfigureAwait(false); }
    catch (OperationCanceledException) { }
  }

  private IReadOnlyList<EvaluationCommandOptions> ValidatedCommands()
  {
    var allowed = new[] { "TESTS", "STATIC_ANALYSIS", "ADVERSARIAL" };
    if (options.Commands.Count is < 3 or > 24 ||
        allowed.Any(check => !options.Commands.Any(command => command.Check == check)) ||
        options.Commands.Any(command => !allowed.Contains(command.Check, StringComparer.Ordinal) ||
          string.IsNullOrWhiteSpace(command.FileName) || Path.IsPathRooted(command.WorkingDirectory) ||
          command.WorkingDirectory.Split('/', '\\').Any(part => part is ".." or "") ||
          command.TimeoutSeconds is < 1 or > 1_800 || command.Arguments.Count > 64 ||
          command.Arguments.Any(argument => argument.Length > 2_000 || argument.Contains('\0'))))
      throw new InvalidOperationException("Evaluator command configuration is invalid.");
    return options.Commands;
  }

  private static EvaluationCheckSet BuildChecks(
    VmEvaluationSession session,
    GeneratedUpdateManifest manifest,
    MaterializationEvidence materialized,
    IReadOnlyList<CheckExecutionEvidence> commands)
  {
    bool Passed(string check) => commands.Where(item => item.Check == check)
      .All(item => item.ExitCode == 0 && !item.TimedOut) && commands.Any(item => item.Check == check);
    return new(session.IsolatedWindowsVm,
      GeneratedManifestValidator.FixedHex(session.BaseRevisionSha256, manifest.BaseRevisionSha256),
      Passed("TESTS"), Passed("STATIC_ANALYSIS"), Passed("ADVERSARIAL"),
      materialized.SupervisorIntegrity, materialized.ProtectedBoundaryDiff,
      session.NtfsIsolationVerified);
  }

  private static List<string> FailureCodes(EvaluationCheckSet checks)
  {
    var failures = new List<string>();
    if (!checks.IsolatedWindowsVm) failures.Add("ISOLATED_WINDOWS_VM_FAILED");
    if (!checks.BaseRevisionMatch) failures.Add("BASE_REVISION_MISMATCH");
    if (!checks.Tests) failures.Add("TESTS_FAILED");
    if (!checks.StaticAnalysis) failures.Add("STATIC_ANALYSIS_FAILED");
    if (!checks.AdversarialEvaluation) failures.Add("ADVERSARIAL_EVALUATION_FAILED");
    if (!checks.SupervisorIntegrity) failures.Add("SUPERVISOR_INTEGRITY_FAILED");
    if (!checks.ProtectedBoundaryDiff) failures.Add("PROTECTED_BOUNDARY_DIFF_FAILED");
    if (!checks.NtfsReparseHardLinkAndToctouIsolation) failures.Add("NTFS_ISOLATION_FAILED");
    return failures;
  }

  private IReadOnlyList<ArtifactDescriptor> CreateArtifacts(
    EvaluationCheckpoint checkpoint,
    EvaluationLease lease,
    GeneratedUpdateManifest manifest,
    VmEvaluationSession session,
    string sourcePath,
    long sourceSize,
    string sourceSha,
    string rollbackPath,
    long rollbackSize,
    string rollbackSha,
    string reportPath,
    long reportSize,
    string reportSha)
  {
    var now = timeProvider.GetUtcNow();
    ArtifactDescriptor Create(string purpose, string name, string mime, string path, long size,
      string digest)
    {
      var id = EvaluatorAttestationFactory.DeterministicArtifactId(lease.Id, purpose);
      var envelope = checkpoint.ArtifactAttestations.TryGetValue(purpose, out var existing)
        ? existing
        : attestations.Artifact(artifactSigner, lease, manifest, session, id, purpose, name, mime,
          size, digest, now);
      AssertArtifactEnvelope(envelope, id, purpose, digest, size);
      return new(id, purpose, name, mime, path, size, digest, envelope);
    }
    return
    [
      Create("SOURCE", "evaluated-source.zip", "application/zip", sourcePath, sourceSize, sourceSha),
      Create("ROLLBACK", "evaluated-rollback.zip", "application/zip", rollbackPath, rollbackSize,
        rollbackSha),
      Create("REPORT", "evaluation-report.json", "application/json", reportPath, reportSize,
        reportSha),
    ];
  }

  private static void AssertArtifactEnvelope(
    SignedAttestationEnvelope envelope,
    string artifactId,
    string purpose,
    string digest,
    long size)
  {
    using var document = JsonDocument.Parse(envelope.ClaimsJson);
    var root = document.RootElement;
    if (root.GetProperty("artifactId").GetString() != artifactId ||
        root.GetProperty("artifactPurpose").GetString() != purpose ||
        root.GetProperty("sha256").GetString() != digest ||
        root.GetProperty("byteSize").GetString() != size.ToString(CultureInfo.InvariantCulture))
      throw new InvalidDataException("Persisted artifact attestation does not match regenerated bytes.");
  }

  private static void AssertIndependentReviews(IReadOnlyList<ReviewerDecision> decisions)
  {
    if (decisions.Count != 2 || decisions.Select(item => item.ReviewerId)
          .Distinct(StringComparer.OrdinalIgnoreCase).Count() != 2 ||
        decisions.Select(item => item.ModelId).Distinct(StringComparer.OrdinalIgnoreCase).Count() != 2)
      throw new EvaluationProtocolException("EVALUATOR_REVIEWS_NOT_INDEPENDENT");
  }

  private sealed record PendingReview(
    ReviewerRegistration Registration,
    Task<ReviewerDecision> Task);

  private static string BuildReport(
    EvaluationLease lease,
    GeneratedUpdateManifest manifest,
    VmEvaluationSession session,
    EvaluationCheckSet checks,
    MaterializationEvidence materialized,
    IReadOnlyList<CheckExecutionEvidence> commands,
    string sourceSha,
    string rollbackSha) => CanonicalJson.Serialize(new
    {
      protocol = "msaidizi-isolated-update-evaluation-report/v1",
      lease = new
      {
        lease.EvaluationRunId,
        lease.CandidateId,
        lease.TaskId,
        lease.PlanVersionId,
        lease.StepId,
        lease.RequestDigest,
        lease.LeaseGeneration,
      },
      manifest = new
      {
        manifest.Name,
        manifest.Version,
        manifest.RollbackVersion,
        manifest.Scope,
        manifest.BaseRevisionSha256,
        generationManifestSha256 = lease.GenerationArtifactSha256,
        paths = manifest.Changes.Select(change => new
        {
          change.RelativePath,
          change.Operation,
          change.ExpectedPreSha256,
          change.ContentSha256,
        }).ToArray(),
      },
      vm = new
      {
        session.CleanSnapshotId,
        session.BaseRevisionSha256,
        session.ToolchainVersions,
      },
      checks,
      materialization = new
      {
        materialized.SupervisorIntegrity,
        materialized.ProtectedBoundaryDiff,
      },
      commands = commands.Select(command => new
      {
        command.Check,
        command.ExitCode,
        command.TimedOut,
        command.CpuTimeSeconds,
        command.StdoutSha256,
        command.StderrSha256,
      }).ToArray(),
      artifacts = new { sourceSha256 = sourceSha, rollbackSha256 = rollbackSha },
    });

  private string OwnedRunRoot(string runId)
  {
    if (!Guid.TryParseExact(runId, "D", out _))
      throw new InvalidDataException("Evaluator run id is invalid.");
    var path = Path.GetFullPath(Path.Combine(_transferRoot, runId.ToLowerInvariant(), "artifacts"));
    if (!path.StartsWith(_transferRoot + Path.DirectorySeparatorChar,
          StringComparison.OrdinalIgnoreCase))
      throw new InvalidDataException("Evaluator artifact path escaped its root.");
    return path;
  }

  private static void AssertSession(
    VmEvaluationSession session,
    EvaluationLease lease)
  {
    if (session.RunId != lease.Id || !GeneratedManifestValidator.IsIdentifier(session.CleanSnapshotId) ||
        !GeneratedManifestValidator.IsSha256(session.BaseRevisionSha256) ||
        session.ToolchainVersions.Count == 0 || session.ToolchainVersions.Count > 32 ||
        session.ToolchainVersions.Any(item => !GeneratedManifestValidator.IsIdentifier(item.Key) ||
          item.Value.Length is < 1 or > 80))
      throw new EvaluationProtocolException("EVALUATOR_VM_SESSION_INVALID");
  }

  private static void AssertCheckpointBinding(
    EvaluationCheckpoint checkpoint,
    EvaluationLease lease)
  {
    if (!string.Equals(CanonicalJson.Serialize(checkpoint.Lease), CanonicalJson.Serialize(lease),
          StringComparison.Ordinal))
      throw new EvaluationProtocolException("EVALUATOR_CHECKPOINT_LEASE_MISMATCH");
  }
}
