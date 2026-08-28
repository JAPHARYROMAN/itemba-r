using System.Security.Cryptography;
using System.Text;
using System.Globalization;
using Itemba.Msaidizi.UpdateEvaluator.Configuration;
using Itemba.Msaidizi.UpdateEvaluator.Contracts;
using Itemba.Msaidizi.UpdateEvaluator.Security;

namespace Itemba.Msaidizi.UpdateEvaluator.Protocol;

public sealed class EvaluatorAttestationFactory(UpdateEvaluatorOptions options)
{
  public SignedAttestationEnvelope Artifact(
    IAttestationSigner signer,
    EvaluationLease lease,
    GeneratedUpdateManifest manifest,
    VmEvaluationSession session,
    string artifactId,
    string purpose,
    string name,
    string mimeType,
    long byteSize,
    string sha256,
    DateTimeOffset now)
  {
    if (purpose is not ("SOURCE" or "ROLLBACK" or "REPORT") ||
        !GeneratedManifestValidator.IsUuid(artifactId) || byteSize < 1 ||
        !GeneratedManifestValidator.IsSha256(sha256))
      throw new EvaluationProtocolException("EVALUATOR_ARTIFACT_CLAIMS_INVALID");
    var claims = GeneratedBinding(lease, manifest);
    claims["schemaVersion"] = 2;
    claims["type"] = "TRUSTED_UPDATE_ARTIFACT";
    claims["signerKeyId"] = signer.KeyId;
    claims["artifactId"] = artifactId;
    claims["artifactPurpose"] = purpose;
    claims["taskId"] = lease.TaskId;
    claims["planVersionId"] = lease.PlanVersionId;
    claims["stepId"] = lease.StepId;
    claims["candidateId"] = purpose == "REPORT" ? lease.CandidateId : null;
    claims["name"] = name;
    claims["mimeType"] = mimeType;
    claims["byteSize"] = byteSize.ToString(CultureInfo.InvariantCulture);
    claims["sha256"] = sha256;
    claims["dataClass"] = DataClass(manifest.Scope);
    claims["evaluationRunId"] = lease.EvaluationRunId;
    claims["cleanSnapshotId"] = session.CleanSnapshotId;
    claims["toolchainVersions"] = session.ToolchainVersions;
    claims["provenance"] = new Dictionary<string, object?>
    {
      ["producer"] = "ISOLATED_WINDOWS_VERIFIER",
      ["source"] = "CLEAN_SNAPSHOT_BUILD",
    };
    AddClock(claims, now);
    return signer.Sign(claims);
  }

  public SignedAttestationEnvelope Runner(
    IAttestationSigner signer,
    EvaluationBinding binding,
    EvaluationLease lease,
    EvaluationCheckSet checks,
    EvaluationUsageSnapshot usage,
    IReadOnlyList<string> failureCodes,
    DateTimeOffset now)
  {
    var claims = Binding(binding);
    claims["schemaVersion"] = 2;
    claims["type"] = "UPDATE_EVALUATION_RUNNER";
    claims["signerKeyId"] = signer.KeyId;
    claims["checks"] = new Dictionary<string, object?>
    {
      ["isolatedWindowsVm"] = checks.IsolatedWindowsVm,
      ["tests"] = checks.Tests,
      ["staticAnalysis"] = checks.StaticAnalysis,
      ["adversarialEvaluation"] = checks.AdversarialEvaluation,
      ["supervisorIntegrity"] = checks.SupervisorIntegrity,
      ["protectedBoundaryDiff"] = checks.ProtectedBoundaryDiff,
      ["baseRevisionMatch"] = checks.BaseRevisionMatch,
      ["ntfsReparseHardLinkAndToctouIsolation"] =
        checks.NtfsReparseHardLinkAndToctouIsolation,
    };
    claims["verdict"] = checks.AllPassed ? "PASS" : "FAIL";
    claims["failureCodes"] = failureCodes;
    AddTerminalAccounting(claims, lease, usage);
    AddClock(claims, now);
    return signer.Sign(claims);
  }

  public SignedAttestationEnvelope Review(
    IAttestationSigner signer,
    EvaluationBinding binding,
    EvaluationLease lease,
    EvaluationUsageSnapshot usage,
    ReviewerDecision decision,
    string runnerClaimsDigest,
    DateTimeOffset now)
  {
    if (decision.ReviewerId.Length is < 1 or > 128 || decision.ModelId.Length is < 1 or > 128 ||
        decision.Verdict is not ("APPROVE" or "REJECT") ||
        !GeneratedManifestValidator.IsSha256(runnerClaimsDigest) ||
        !SafeRationale(decision.Rationale))
      throw new EvaluationProtocolException("EVALUATOR_REVIEW_EVIDENCE_INVALID");
    var claims = Binding(binding);
    claims["schemaVersion"] = 2;
    claims["type"] = "UPDATE_MODEL_REVIEW";
    claims["signerKeyId"] = signer.KeyId;
    claims["runnerClaimsDigest"] = runnerClaimsDigest;
    claims["reviewerId"] = decision.ReviewerId;
    claims["modelId"] = decision.ModelId;
    claims["verdict"] = decision.Verdict;
    claims["rationale"] = decision.Rationale;
    AddTerminalAccounting(claims, lease, usage);
    AddClock(claims, now);
    return signer.Sign(claims);
  }

  public static string ClaimsDigest(SignedAttestationEnvelope envelope) =>
    Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(envelope.ClaimsJson)))
      .ToLowerInvariant();

  public static string DeterministicArtifactId(string runId, string purpose)
  {
    var hash = SHA256.HashData(Encoding.UTF8.GetBytes(
      $"msaidizi-evaluation-artifact/v1\0{runId.ToLowerInvariant()}\0{purpose}"));
    try
    {
      Span<byte> uuid = stackalloc byte[16];
      hash.AsSpan(0, 16).CopyTo(uuid);
      uuid[6] = (byte)((uuid[6] & 0x0f) | 0x40);
      uuid[8] = (byte)((uuid[8] & 0x3f) | 0x80);
      return new Guid(uuid, bigEndian: true).ToString("D");
    }
    finally
    {
      CryptographicOperations.ZeroMemory(hash);
    }
  }

  private Dictionary<string, object?> GeneratedBinding(
    EvaluationLease lease,
    GeneratedUpdateManifest manifest) => new()
    {
      ["requestDigest"] = lease.RequestDigest,
      ["generationArtifactId"] = lease.GenerationArtifactId,
      ["generationArtifactSha256"] = lease.GenerationArtifactSha256,
      ["generationManifestSha256"] = lease.GenerationArtifactSha256,
      ["protectedPolicyVersion"] = options.ProtectedPolicyVersion,
      ["protectedPolicySha256"] = options.ProtectedPolicySha256,
      ["baseRevisionSha256"] = manifest.BaseRevisionSha256,
    };

  private static Dictionary<string, object?> Binding(EvaluationBinding binding) => new()
  {
    ["candidateId"] = binding.CandidateId,
    ["taskId"] = binding.TaskId,
    ["planVersionId"] = binding.PlanVersionId,
    ["stepId"] = binding.StepId,
    ["sourceArtifactId"] = binding.SourceArtifactId,
    ["sourceArtifactSha256"] = binding.SourceArtifactSha256,
    ["rollbackArtifactId"] = binding.RollbackArtifactId,
    ["rollbackArtifactSha256"] = binding.RollbackArtifactSha256,
    ["rollbackVersion"] = binding.RollbackVersion,
    ["reportArtifactId"] = binding.ReportArtifactId,
    ["reportArtifactSha256"] = binding.ReportArtifactSha256,
    ["evaluationRunId"] = binding.EvaluationRunId,
    ["cleanSnapshotId"] = binding.CleanSnapshotId,
    ["toolchainVersions"] = binding.ToolchainVersions,
    ["requestDigest"] = binding.RequestDigest,
    ["generationArtifactId"] = binding.GenerationArtifactId,
    ["generationArtifactSha256"] = binding.GenerationArtifactSha256,
    ["generationManifestSha256"] = binding.GenerationManifestSha256,
    ["protectedPolicyVersion"] = binding.ProtectedPolicyVersion,
    ["protectedPolicySha256"] = binding.ProtectedPolicySha256,
    ["baseRevisionSha256"] = binding.BaseRevisionSha256,
  };

  private static void AddTerminalAccounting(
    IDictionary<string, object?> claims,
    EvaluationLease lease,
    EvaluationUsageSnapshot usage)
  {
    claims["evaluationLeaseGeneration"] = lease.LeaseGeneration;
    claims["finalUsage"] = new Dictionary<string, object?>
    {
      ["cpuTimeSeconds"] = usage.CpuTimeSeconds,
      ["bytesRead"] = usage.BytesRead,
      ["bytesWritten"] = usage.BytesWritten,
      ["externalEgressBytes"] = usage.ExternalEgressBytes,
      ["modelTurns"] = usage.ModelTurns,
      ["modelInputTokens"] = usage.ModelInputTokens,
      ["modelOutputTokens"] = usage.ModelOutputTokens,
      ["modelCostMicrousd"] = usage.ModelCostMicrousd,
    };
  }

  private void AddClock(IDictionary<string, object?> claims, DateTimeOffset now)
  {
    var issued = now.ToUniversalTime();
    var expires = issued.AddSeconds(options.AttestationTtlSeconds);
    claims["issuedAt"] = Timestamp(issued);
    claims["expiresAt"] = Timestamp(expires);
    claims["nonce"] = Guid.NewGuid().ToString("D");
  }

  private static string DataClass(string scope) =>
    "msaidizi.self-improvement." + scope.ToLowerInvariant().Replace('_', '-');

  private static string Timestamp(DateTimeOffset value) =>
    value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
      System.Globalization.CultureInfo.InvariantCulture);

  private static bool SafeRationale(string value) =>
    value.Length is >= 1 and <= 2_000 && value == value.Normalize(NormalizationForm.FormC) &&
    !value.Any(character => char.IsControl(character) && character is not '\n' and not '\t') &&
    !System.Text.RegularExpressions.Regex.IsMatch(value,
      @"(?i)(?:api[_-]?key|access[_-]?token|password|client[_-]?secret)\s*[:=]");
}
