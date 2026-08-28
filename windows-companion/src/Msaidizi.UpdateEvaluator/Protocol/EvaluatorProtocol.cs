using System.Security.Cryptography;
using System.Globalization;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.UpdateEvaluator.Configuration;
using Itemba.Msaidizi.UpdateEvaluator.Contracts;

namespace Itemba.Msaidizi.UpdateEvaluator.Protocol;

public sealed class EvaluationProtocolException(string code) : Exception(code)
{
  public string Code { get; } = code;
}

public sealed class GeneratedManifestValidator(UpdateEvaluatorOptions options)
{
  private static readonly string[] ExpectedChecks =
  [
    "adversarialEvaluation",
    "baseRevisionMatch",
    "dualIndependentModelReview",
    "isolatedWindowsVm",
    "ntfsReparseHardLinkAndToctouIsolation",
    "protectedBoundaryDiff",
    "staticAnalysis",
    "supervisorIntegrity",
    "tests",
  ];

  private static readonly Dictionary<string, string[]> ScopeRoots =
    new Dictionary<string, string[]>(StringComparer.Ordinal)
    {
      ["PROMPT"] = ["backend/src/modules/msaidizi/", "backend/src/modules/msaidizi-reasoning/"],
      ["SKILL"] = ["skills/", "backend/src/modules/msaidizi-skills/"],
      ["APPLICATION"] = ["backend/", "frontend/", "mobile/", "database/"],
      ["ADAPTERS"] =
      [
        "backend/src/modules/msaidizi-devices/",
        "windows-companion/src/msaidizi.companion.agent/",
        "windows-companion/src/msaidizi.companion.contracts/",
        "windows-companion/src/msaidizi.companion.service/",
      ],
      ["OPERATIONAL_POLICY"] = ["backend/src/modules/msaidizi/", "config/", "docs/"],
      ["DEPLOYMENT_CANDIDATE"] = ["backend/", "frontend/", "mobile/", "database/", "deploy/"],
    };

  private static readonly string[] ProtectedPrefixes =
  [
    ".github/workflows/",
    "backend/scripts/",
    "backend/src/common/capabilities/",
    "backend/src/common/context/",
    "backend/src/common/decorators/",
    "backend/src/common/guards/",
    "backend/src/common/interceptors/",
    "backend/src/common/policies/",
    "backend/src/config/",
    "backend/src/modules/audit-logs/",
    "backend/src/modules/auth/",
    "backend/src/modules/msaidizi-audit-signer/",
    "backend/src/modules/msaidizi-control-plane/",
    "backend/src/modules/msaidizi-devices/",
    "backend/src/modules/msaidizi-recovery/",
    "backend/src/modules/msaidizi-task-runtime/",
    "backend/src/modules/msaidizi-tasks/",
    "backend/src/modules/msaidizi-updates/",
    "backend/src/modules/security/",
    "backend/src/modules/security-events/",
    "backend/src/modules/security-policies/",
    "backend/src/prisma/",
    "database/prisma/migrations/",
    "deploy/",
    "windows-companion/config/",
    "windows-companion/installer/",
    "windows-companion/locks/",
    "windows-companion/scripts/",
    "windows-companion/src/msaidizi.auditsigner/",
    "windows-companion/src/msaidizi.egresssupervisor/",
    "windows-companion/src/msaidizi.privilegedcommandsupervisor/",
    "windows-companion/src/msaidizi.recoverysupervisor/",
    "windows-companion/src/msaidizi.updatesupervisor/",
    "windows-companion/src/msaidizi.updateevaluator/",
    "windows-companion/src/msaidizi.companion.service/channel/",
    "windows-companion/src/msaidizi.companion.service/configuration/",
    "windows-companion/src/msaidizi.companion.service/execution/",
    "windows-companion/src/msaidizi.companion.service/journal/",
    "windows-companion/src/msaidizi.companion.service/security/",
    "windows-companion/src/msaidizi.companion.contracts/security/",
  ];

  private static readonly string[] ProtectedExact =
  [
    ".env.production.example",
    "backend/.env.production.example",
    "backend/dockerfile",
    "backend/nest-cli.json",
    "backend/package-lock.json",
    "backend/package.json",
    "backend/tsconfig.build.json",
    "backend/tsconfig.json",
    "backend/src/app.module.ts",
    "backend/src/main.ts",
    "database/prisma/schema.prisma",
    "docker-compose.production.yml",
    "docker-compose.staging.yml",
    "package-lock.json",
    "package.json",
    "windows-companion/directory.build.props",
    "windows-companion/directory.packages.props",
    "windows-companion/global.json",
    "windows-companion/msaidizi.windowscompanion.sln",
  ];

  private static readonly string[] ProtectedFragments =
  [
    "bootstrap",
    "trust-key",
    "trustkey",
    "kill-switch",
    "killswitch",
    "audit-signer",
    "auditsigner",
    "recovery-vault",
    "recoveryvault",
    "update-verif",
    "supervisor",
    "device-identity",
    "deviceidentity",
    "hardware-key",
  ];

  private static readonly string[] SensitiveCapabilityFragments =
  [
    "capabilityregistry",
    "egress",
    "privilegedcommand",
    "recovery",
    "trustedroot",
    "vault",
  ];

  private static readonly string[] ManifestKeys =
  [
    "attemptId",
    "baseRevisionSha256",
    "changes",
    "evaluationBudget",
    "name",
    "planVersionId",
    "protectedPathPolicySha256",
    "protectedPathPolicyVersion",
    "protectedSupervisorBoundary",
    "protocol",
    "rationale",
    "rollbackVersion",
    "scope",
    "stepId",
    "taskId",
    "version",
  ];

  public GeneratedUpdateManifest Validate(EvaluationLease lease, ReadOnlySpan<byte> content)
  {
    AssertLease(lease);
    var digest = Sha256(content);
    if (!FixedHex(digest, lease.GenerationArtifactSha256))
      throw Error("EVALUATOR_GENERATION_ARTIFACT_DIGEST_MISMATCH");
    JsonNode root;
    try
    {
      root = JsonNode.Parse(content) ?? throw Error("EVALUATOR_MANIFEST_JSON_INVALID");
    }
    catch (JsonException)
    {
      throw Error("EVALUATOR_MANIFEST_JSON_INVALID");
    }
    if (root is not JsonObject manifestObject ||
        !content.SequenceEqual(Encoding.UTF8.GetBytes(CanonicalJson.Serialize(manifestObject))))
      throw Error("EVALUATOR_MANIFEST_NOT_CANONICAL");
    ExactKeys(manifestObject, ManifestKeys, "EVALUATOR_MANIFEST_SCHEMA_INVALID");
    GeneratedUpdateManifest manifest;
    try
    {
      manifest = manifestObject.Deserialize<GeneratedUpdateManifest>(JsonDefaults.Options)
        ?? throw Error("EVALUATOR_MANIFEST_SCHEMA_INVALID");
    }
    catch (JsonException)
    {
      throw Error("EVALUATOR_MANIFEST_SCHEMA_INVALID");
    }
    if (manifest.Protocol != options.ProtectedPolicyVersion ||
        manifest.ProtectedPathPolicyVersion != options.ProtectedPolicyVersion ||
        manifest.ProtectedSupervisorBoundary != "EXCLUDED" ||
        !FixedHex(manifest.ProtectedPathPolicySha256, options.ProtectedPolicySha256) ||
        !FixedHex(lease.PolicyDigest, options.ProtectedPolicySha256) ||
        lease.PolicyVersion != options.ProtectedPolicyVersion)
      throw Error("EVALUATOR_PROTECTED_POLICY_BINDING_INVALID");
    if (manifest.TaskId != lease.TaskId || manifest.PlanVersionId != lease.PlanVersionId ||
        manifest.StepId != lease.StepId || !IsUuid(manifest.AttemptId) ||
        !IsSha256(manifest.BaseRevisionSha256) || !BudgetsEqual(manifest.EvaluationBudget, lease.Budgets))
      throw Error("EVALUATOR_MANIFEST_LEASE_BINDING_INVALID");
    if (!ScopeRoots.TryGetValue(manifest.Scope, out var roots) || manifest.Changes.Count is < 1 or > 128)
      throw Error("EVALUATOR_MANIFEST_SCOPE_INVALID");

    var previous = string.Empty;
    long totalBytes = 0;
    foreach (var change in manifest.Changes)
    {
      AssertChange(change, roots, ref totalBytes);
      var key = change.RelativePath.ToLowerInvariant();
      if (string.CompareOrdinal(previous, key) >= 0)
        throw Error("EVALUATOR_CHANGESET_NOT_CANONICAL");
      previous = key;
    }
    return manifest;
  }

  public void AssertLease(EvaluationLease lease)
  {
    if (!IsUuid(lease.Id) || !IsUuid(lease.CandidateId) || !IsUuid(lease.TaskId) ||
        !IsUuid(lease.PlanVersionId) || !IsUuid(lease.StepId) || !IsUuid(lease.LeaseId) ||
        !IsUuid(lease.GenerationArtifactId) || !IsIdentifier(lease.EvaluationRunId) ||
        !IsSha256(lease.RequestDigest) || !IsSha256(lease.GenerationArtifactSha256) ||
        lease.LeaseGeneration < 1 || lease.LeaseExpiresAt == default ||
        lease.PolicyVersion != options.ProtectedPolicyVersion ||
        !FixedHex(lease.PolicyDigest, options.ProtectedPolicySha256))
      throw Error("EVALUATOR_LEASE_BINDING_INVALID");
    var actual = lease.RequiredChecks.OrderBy(item => item.Key, StringComparer.Ordinal).ToArray();
    if (actual.Length != ExpectedChecks.Length || actual.Any(item => !item.Value) ||
        actual.Select(item => item.Key).Where((key, index) => key != ExpectedChecks[index]).Any())
      throw Error("EVALUATOR_REQUIRED_CHECKS_INVALID");
    EvaluationBudget.Parse(lease.Budgets);
  }

  private static void AssertChange(
    GeneratedFileChange change,
    IReadOnlyList<string> roots,
    ref long totalBytes)
  {
    var path = change.RelativePath;
    if (path != path.Normalize(NormalizationForm.FormC) || path.Length is < 1 or > 240 ||
        path.StartsWith('/') || path.Contains('\\') || path.Contains(':') ||
        path.Any(character => char.IsControl(character)))
      throw Error("EVALUATOR_CHANGE_PATH_INVALID");
    var segments = path.Split('/');
    if (segments.Any(segment => segment.Length == 0 || segment is "." or ".." ||
        segment.EndsWith('.') || segment.EndsWith(' ') || IsReservedDeviceName(segment)))
      throw Error("EVALUATOR_CHANGE_PATH_INVALID");
    var canonical = path.ToLowerInvariant();
    if (!roots.Any(root => canonical.StartsWith(root, StringComparison.Ordinal)) ||
        ProtectedExact.Contains(canonical, StringComparer.Ordinal) ||
        ProtectedPrefixes.Any(prefix => canonical.StartsWith(prefix, StringComparison.Ordinal)) ||
        ProtectedFragments.Any(canonical.Contains))
      throw Error("EVALUATOR_PROTECTED_PATH_DENIED");
    if (canonical.StartsWith("windows-companion/src/msaidizi.companion.service/capabilities/",
          StringComparison.Ordinal) &&
        SensitiveCapabilityFragments.Any(canonical.Contains))
      throw Error("EVALUATOR_PROTECTED_PATH_DENIED");

    if (change.Operation is not ("ADD" or "UPDATE" or "DELETE"))
      throw Error("EVALUATOR_CHANGESET_INVALID");
    var expectsExisting = change.Operation is "UPDATE" or "DELETE";
    if (expectsExisting != (change.ExpectedPreSha256 is not null) ||
        change.ExpectedPreSha256 is not null && !IsSha256(change.ExpectedPreSha256))
      throw Error("EVALUATOR_CHANGESET_INVALID");
    if (change.Operation == "DELETE")
    {
      if (change.ContentBase64 is not null || change.ContentSha256 is not null)
        throw Error("EVALUATOR_CHANGESET_INVALID");
      return;
    }
    if (change.ContentBase64 is null || !IsSha256(change.ContentSha256))
      throw Error("EVALUATOR_CHANGESET_INVALID");
    byte[] decoded;
    try
    {
      decoded = Convert.FromBase64String(change.ContentBase64);
    }
    catch (FormatException)
    {
      throw Error("EVALUATOR_CHANGESET_INVALID");
    }
    try
    {
      if (Convert.ToBase64String(decoded) != change.ContentBase64 || decoded.Length is < 1 or > 1_048_576 ||
          !FixedHex(Sha256(decoded), change.ContentSha256))
        throw Error("EVALUATOR_CHANGESET_INVALID");
      totalBytes = checked(totalBytes + decoded.Length);
      if (totalBytes > 4_194_304) throw Error("EVALUATOR_CHANGESET_INVALID");
    }
    finally
    {
      CryptographicOperations.ZeroMemory(decoded);
    }
  }

  private static bool BudgetsEqual(EvaluationBudgets left, EvaluationBudgets right) =>
    left == right;

  private static bool IsReservedDeviceName(string value)
  {
    var stem = value.Split('.')[0];
    return stem.Equals("CON", StringComparison.OrdinalIgnoreCase) ||
      stem.Equals("PRN", StringComparison.OrdinalIgnoreCase) ||
      stem.Equals("AUX", StringComparison.OrdinalIgnoreCase) ||
      stem.Equals("NUL", StringComparison.OrdinalIgnoreCase) ||
      stem.Equals("CLOCK$", StringComparison.OrdinalIgnoreCase) ||
      stem.Length == 4 &&
      (stem.StartsWith("COM", StringComparison.OrdinalIgnoreCase) ||
       stem.StartsWith("LPT", StringComparison.OrdinalIgnoreCase)) &&
      stem[3] is >= '1' and <= '9';
  }

  private static void ExactKeys(JsonObject value, IReadOnlyList<string> expected, string code)
  {
    var actual = value.Select(item => item.Key).OrderBy(key => key, StringComparer.Ordinal).ToArray();
    if (!actual.SequenceEqual(expected.OrderBy(key => key, StringComparer.Ordinal), StringComparer.Ordinal))
      throw Error(code);
  }

  private static EvaluationProtocolException Error(string code) => new(code);
  public static bool IsUuid(string? value) => Guid.TryParseExact(value, "D", out _);
  public static bool IsSha256(string? value) =>
    value is { Length: 64 } && value.All(character => character is >= '0' and <= '9' or >= 'a' and <= 'f');
  public static bool IsIdentifier(string? value) => value is { Length: >= 1 and <= 128 } &&
    value.All(character => char.IsAsciiLetterOrDigit(character) || character is '.' or '_' or ':' or '-');
  public static string Sha256(ReadOnlySpan<byte> value) =>
    Convert.ToHexString(SHA256.HashData(value)).ToLowerInvariant();
  public static bool FixedHex(string? left, string? right) =>
    IsSha256(left) && IsSha256(right) && CryptographicOperations.FixedTimeEquals(
      Encoding.ASCII.GetBytes(left!), Encoding.ASCII.GetBytes(right!));
}

public sealed record EvaluationBudget(
  int MaxWallTimeSeconds,
  int MaxCpuTimeSeconds,
  long MaxBytesRead,
  long MaxBytesWritten,
  long MaxExternalEgressBytes,
  int MaxModelTurns,
  long MaxModelInputTokens,
  long MaxModelOutputTokens,
  long MaxModelCostMicrousd)
{
  public static EvaluationBudget Parse(EvaluationBudgets value)
  {
    if (value.MaxWallTimeSeconds is < 60 or > 7_200 ||
        value.MaxCpuTimeSeconds is < 1 or > 57_600 ||
        value.MaxModelTurns is < 2 or > 20 ||
        !CanonicalLong(value.MaxBytesRead, 1, 5_368_709_120, out var read) ||
        !CanonicalLong(value.MaxBytesWritten, 1, 5_368_709_120, out var written) ||
        read + written > 5_368_709_120 ||
        !CanonicalLong(value.MaxExternalEgressBytes, 0, 262_144_000, out var egress) ||
        !CanonicalLong(value.MaxModelInputTokens, 1, 2_000_000, out var input) ||
        !CanonicalLong(value.MaxModelOutputTokens, 1, 200_000, out var output) ||
        !CanonicalLong(value.MaxModelCostMicrousd, 0, 20_000_000, out var cost))
      throw new EvaluationProtocolException("EVALUATOR_BUDGET_INVALID");
    return new(value.MaxWallTimeSeconds, value.MaxCpuTimeSeconds, read, written, egress,
      value.MaxModelTurns, input, output, cost);
  }

  private static bool CanonicalLong(string value, long minimum, long maximum, out long parsed)
  {
    parsed = 0;
    var canonical = value == "0" || value.Length > 0 && value[0] is >= '1' and <= '9' &&
      value.All(char.IsAsciiDigit);
    return canonical && long.TryParse(value, out parsed) && parsed >= minimum && parsed <= maximum;
  }
}

public sealed class EvaluationUsageMeter
{
  private readonly object _gate = new();
  private readonly EvaluationBudget _budget;
  private long _cpu;
  private long _read;
  private long _written;
  private long _egress;
  private int _turns;
  private long _input;
  private long _output;
  private long _cost;

  public EvaluationUsageMeter(EvaluationBudget budget, EvaluationUsageSnapshot? seed = null)
  {
    _budget = budget;
    if (seed is null) return;
    if (!long.TryParse(seed.BytesRead, out _read) || !long.TryParse(seed.BytesWritten, out _written) ||
        !long.TryParse(seed.ExternalEgressBytes, out _egress) ||
        !long.TryParse(seed.ModelInputTokens, out _input) ||
        !long.TryParse(seed.ModelOutputTokens, out _output) ||
        !long.TryParse(seed.ModelCostMicrousd, out _cost))
      throw new EvaluationProtocolException("EVALUATOR_USAGE_INVALID");
    _cpu = seed.CpuTimeSeconds;
    _turns = seed.ModelTurns;
    AssertWithinBudget();
  }

  public void AddLocal(long read = 0, long written = 0, int cpuSeconds = 0) =>
    Mutate(cpuSeconds, read, written, 0, 0, 0, 0, 0);

  public void AddEgress(long bytes) => Mutate(0, 0, 0, bytes, 0, 0, 0, 0);

  public void AddModelTurn(long inputTokens, long outputTokens, long costMicrousd,
    long egressBytes) => Mutate(0, 0, 0, egressBytes, 1, inputTokens, outputTokens, costMicrousd);

  public void RaiseIoFloor(long bytesRead, long externalEgressBytes)
  {
    if (bytesRead < 0 || externalEgressBytes < 0)
      throw new EvaluationProtocolException("EVALUATOR_USAGE_INVALID");
    lock (_gate)
    {
      var nextRead = Math.Max(_read, bytesRead);
      var nextEgress = Math.Max(_egress, externalEgressBytes);
      if (nextRead > _budget.MaxBytesRead || nextEgress > _budget.MaxExternalEgressBytes)
        throw new EvaluationProtocolException("EVALUATOR_BUDGET_EXCEEDED");
      _read = nextRead;
      _egress = nextEgress;
    }
  }

  public EvaluationUsageSnapshot Snapshot()
  {
    lock (_gate)
      return new(
        checked((int)_cpu),
        _read.ToString(CultureInfo.InvariantCulture),
        _written.ToString(CultureInfo.InvariantCulture),
        _egress.ToString(CultureInfo.InvariantCulture),
        _turns,
        _input.ToString(CultureInfo.InvariantCulture),
        _output.ToString(CultureInfo.InvariantCulture),
        _cost.ToString(CultureInfo.InvariantCulture));
  }

  private void Mutate(int cpu, long read, long written, long egress, int turns,
    long input, long output, long cost)
  {
    if (cpu < 0 || read < 0 || written < 0 || egress < 0 || turns < 0 || input < 0 ||
        output < 0 || cost < 0)
      throw new EvaluationProtocolException("EVALUATOR_USAGE_INVALID");
    lock (_gate)
    {
      var nextCpu = checked(_cpu + cpu);
      var nextRead = checked(_read + read);
      var nextWritten = checked(_written + written);
      var nextEgress = checked(_egress + egress);
      var nextTurns = checked(_turns + turns);
      var nextInput = checked(_input + input);
      var nextOutput = checked(_output + output);
      var nextCost = checked(_cost + cost);
      if (nextCpu > _budget.MaxCpuTimeSeconds || nextRead > _budget.MaxBytesRead ||
          nextWritten > _budget.MaxBytesWritten || nextEgress > _budget.MaxExternalEgressBytes ||
          nextTurns > _budget.MaxModelTurns || nextInput > _budget.MaxModelInputTokens ||
          nextOutput > _budget.MaxModelOutputTokens || nextCost > _budget.MaxModelCostMicrousd)
        throw new EvaluationProtocolException("EVALUATOR_BUDGET_EXCEEDED");
      (_cpu, _read, _written, _egress, _turns, _input, _output, _cost) =
        (nextCpu, nextRead, nextWritten, nextEgress, nextTurns, nextInput, nextOutput, nextCost);
    }
  }

  private void AssertWithinBudget()
  {
    if (_cpu < 0 || _read < 0 || _written < 0 || _egress < 0 || _turns < 0 ||
        _input < 0 || _output < 0 || _cost < 0 ||
        _cpu > _budget.MaxCpuTimeSeconds || _read > _budget.MaxBytesRead ||
        _written > _budget.MaxBytesWritten || _egress > _budget.MaxExternalEgressBytes ||
        _turns > _budget.MaxModelTurns || _input > _budget.MaxModelInputTokens ||
        _output > _budget.MaxModelOutputTokens || _cost > _budget.MaxModelCostMicrousd)
      throw new EvaluationProtocolException("EVALUATOR_USAGE_INVALID");
  }
}

internal static class JsonDefaults
{
  public static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
  {
    PropertyNameCaseInsensitive = false,
    ReadCommentHandling = JsonCommentHandling.Disallow,
    UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
  };
}

public static class CanonicalJson
{
  private static readonly JsonSerializerOptions SerializerOptions = new(JsonDefaults.Options)
  {
    Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
  };

  public static string Serialize<T>(T value)
  {
    var node = JsonSerializer.SerializeToNode(value, SerializerOptions)
      ?? throw new InvalidDataException("Canonical JSON root is empty.");
    return Serialize(node);
  }

  public static string Serialize(JsonNode node)
  {
    using var output = new MemoryStream();
    using (var writer = new Utf8JsonWriter(output, new JsonWriterOptions
    {
      Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
      Indented = false,
    }))
      WriteNode(writer, node);
    return Encoding.UTF8.GetString(output.ToArray());
  }

  private static void WriteNode(Utf8JsonWriter writer, JsonNode? node)
  {
    switch (node)
    {
      case null:
        writer.WriteNullValue();
        break;
      case JsonObject value:
        writer.WriteStartObject();
        foreach (var property in value.OrderBy(item => item.Key, StringComparer.Ordinal))
        {
          writer.WritePropertyName(property.Key);
          WriteNode(writer, property.Value);
        }
        writer.WriteEndObject();
        break;
      case JsonArray value:
        writer.WriteStartArray();
        foreach (var item in value) WriteNode(writer, item);
        writer.WriteEndArray();
        break;
      default:
        node.WriteTo(writer, SerializerOptions);
        break;
    }
  }
}
