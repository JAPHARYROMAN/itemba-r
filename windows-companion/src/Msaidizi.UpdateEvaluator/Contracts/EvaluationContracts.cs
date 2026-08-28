using System.Text.Json.Serialization;

namespace Itemba.Msaidizi.UpdateEvaluator.Contracts;

public sealed record EvaluationPollResponse(EvaluationLease? Run);

public sealed record EvaluationLease(
  string Id,
  string EvaluationRunId,
  string CandidateId,
  string TaskId,
  string PlanVersionId,
  string StepId,
  string RequestDigest,
  string GenerationArtifactId,
  string GenerationArtifactSha256,
  string PolicyVersion,
  string PolicyDigest,
  IReadOnlyDictionary<string, bool> RequiredChecks,
  EvaluationBudgets Budgets,
  string LeaseId,
  int LeaseGeneration,
  DateTimeOffset LeaseExpiresAt);

public sealed record EvaluationBudgets(
  int MaxWallTimeSeconds,
  int MaxCpuTimeSeconds,
  string MaxBytesRead,
  string MaxBytesWritten,
  string MaxExternalEgressBytes,
  int MaxModelTurns,
  string MaxModelInputTokens,
  string MaxModelOutputTokens,
  string MaxModelCostMicrousd);

public sealed record EvaluationUsageSnapshot(
  int CpuTimeSeconds,
  string BytesRead,
  string BytesWritten,
  string ExternalEgressBytes,
  int ModelTurns,
  string ModelInputTokens,
  string ModelOutputTokens,
  string ModelCostMicrousd);

public sealed record EvaluationHeartbeatRequest(
  string LeaseId,
  int CpuTimeSeconds,
  string BytesRead,
  string BytesWritten,
  string ExternalEgressBytes,
  int ModelTurns,
  string ModelInputTokens,
  string ModelOutputTokens,
  string ModelCostMicrousd)
{
  public static EvaluationHeartbeatRequest From(
    string leaseId,
    EvaluationUsageSnapshot usage) => new(
      leaseId,
      usage.CpuTimeSeconds,
      usage.BytesRead,
      usage.BytesWritten,
      usage.ExternalEgressBytes,
      usage.ModelTurns,
      usage.ModelInputTokens,
      usage.ModelOutputTokens,
      usage.ModelCostMicrousd);
}

public sealed record EvaluationHeartbeatResponse(
  bool Accepted,
  bool Stop,
  DateTimeOffset? LeaseExpiresAt,
  string? FailureCode);

public sealed record GeneratedUpdateManifest(
  string Protocol,
  string TaskId,
  string PlanVersionId,
  string StepId,
  string AttemptId,
  string Name,
  string Version,
  string RollbackVersion,
  string Scope,
  string Rationale,
  string BaseRevisionSha256,
  IReadOnlyList<GeneratedFileChange> Changes,
  EvaluationBudgets EvaluationBudget,
  string ProtectedSupervisorBoundary,
  string ProtectedPathPolicyVersion,
  string ProtectedPathPolicySha256);

public sealed record GeneratedFileChange(
  string RelativePath,
  string Operation,
  string? ExpectedPreSha256,
  string? ContentBase64,
  string? ContentSha256);

public sealed record VmEvaluationSession(
  string RunId,
  string CleanSnapshotId,
  string BaseRevisionSha256,
  IReadOnlyDictionary<string, string> ToolchainVersions,
  bool IsolatedWindowsVm,
  bool NtfsIsolationVerified);

public sealed record MaterializationEvidence(
  bool SupervisorIntegrity,
  bool ProtectedBoundaryDiff,
  long BytesRead,
  long BytesWritten);

public sealed record CheckExecutionEvidence(
  string Check,
  int ExitCode,
  bool TimedOut,
  int CpuTimeSeconds,
  long BytesRead,
  long BytesWritten,
  string StdoutSha256,
  string StderrSha256,
  string OutputExcerpt);

public sealed record ExportedWorkspace(
  string DirectoryPath,
  long BytesRead,
  long BytesWritten);

public sealed record EvaluationCheckSet(
  bool IsolatedWindowsVm,
  bool BaseRevisionMatch,
  bool Tests,
  bool StaticAnalysis,
  bool AdversarialEvaluation,
  bool SupervisorIntegrity,
  bool ProtectedBoundaryDiff,
  bool NtfsReparseHardLinkAndToctouIsolation)
{
  [JsonIgnore]
  public bool AllPassed =>
    IsolatedWindowsVm && BaseRevisionMatch && Tests && StaticAnalysis &&
    AdversarialEvaluation && SupervisorIntegrity && ProtectedBoundaryDiff &&
    NtfsReparseHardLinkAndToctouIsolation;
}

public sealed record ArtifactDescriptor(
  string ArtifactId,
  string Purpose,
  string Name,
  string MimeType,
  string Path,
  long ByteSize,
  string Sha256,
  SignedAttestationEnvelope Attestation);

public sealed record SignedAttestationEnvelope(string ClaimsJson, string Signature);

public sealed record ReviewerDecision(
  string ReviewerId,
  string ModelId,
  string Verdict,
  string Rationale,
  long InputTokens,
  long OutputTokens,
  long CostMicrousd,
  long RequestBytes,
  long ResponseBytes);

public sealed record EvaluationBinding(
  string CandidateId,
  string TaskId,
  string PlanVersionId,
  string StepId,
  string SourceArtifactId,
  string SourceArtifactSha256,
  string RollbackArtifactId,
  string RollbackArtifactSha256,
  string RollbackVersion,
  string ReportArtifactId,
  string ReportArtifactSha256,
  string EvaluationRunId,
  string CleanSnapshotId,
  IReadOnlyDictionary<string, string> ToolchainVersions,
  string RequestDigest,
  string GenerationArtifactId,
  string GenerationArtifactSha256,
  string GenerationManifestSha256,
  string ProtectedPolicyVersion,
  string ProtectedPolicySha256,
  string BaseRevisionSha256);

public sealed record EvaluationRunResult(
  string CandidateId,
  string Status,
  string BundleDigest,
  bool Replay,
  bool DeploymentCreated);

public sealed record EvaluationCheckpoint(
  EvaluationLease Lease,
  string Stage,
  DateTimeOffset StartedAt,
  EvaluationUsageSnapshot LastUsage,
  IReadOnlyDictionary<string, SignedAttestationEnvelope> ArtifactAttestations,
  IReadOnlyList<string> UploadedArtifactPurposes,
  IReadOnlyList<ReviewerDecision> ReviewerDecisions,
  SignedAttestationEnvelope? RunnerAttestation,
  IReadOnlyList<SignedAttestationEnvelope> ReviewAttestations,
  string? TerminalStatus);
