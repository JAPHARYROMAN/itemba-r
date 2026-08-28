using System.Text.Json.Serialization;
using System.Globalization;
using System.Text;

namespace Itemba.Msaidizi.UpdateSupervisor.Contracts;

public sealed record SignedUpdateCommand(
  string DeploymentId,
  string DeliveryLeaseId,
  string ManifestJson,
  string ManifestSha256,
  string Signature,
  string SigningKeyId);

public sealed class TrustedUpdateManifest
{
  [JsonPropertyName("schemaVersion")]
  public int SchemaVersion { get; init; }
  [JsonPropertyName("deploymentId")]
  public string DeploymentId { get; init; } = string.Empty;
  [JsonPropertyName("candidateId")]
  public string CandidateId { get; init; } = string.Empty;
  [JsonPropertyName("deviceId")]
  public string DeviceId { get; init; } = string.Empty;
  [JsonPropertyName("operation")]
  public string Operation { get; init; } = string.Empty;
  [JsonPropertyName("ring")]
  public int Ring { get; init; }
  [JsonPropertyName("targetId")]
  public string TargetId { get; init; } = string.Empty;
  [JsonPropertyName("version")]
  public string Version { get; init; } = string.Empty;
  [JsonPropertyName("sourceArtifactSha256")]
  public string SourceArtifactSha256 { get; init; } = string.Empty;
  [JsonPropertyName("rollbackArtifactSha256")]
  public string RollbackArtifactSha256 { get; init; } = string.Empty;
  [JsonPropertyName("rollbackVersion")]
  public string RollbackVersion { get; init; } = string.Empty;
  [JsonPropertyName("deliveryLeaseId")]
  public string DeliveryLeaseId { get; init; } = string.Empty;
  [JsonPropertyName("deliveryAttempt")]
  public int DeliveryAttempt { get; init; }
  [JsonPropertyName("healthTimeoutSeconds")]
  public int HealthTimeoutSeconds { get; init; }
  [JsonPropertyName("minimumHealthySoakSeconds")]
  public int MinimumHealthySoakSeconds { get; init; }
  [JsonPropertyName("minimumRingDwellSeconds")]
  public int MinimumRingDwellSeconds { get; init; }
  [JsonPropertyName("issuedAt")]
  public DateTimeOffset IssuedAt { get; init; }
  [JsonPropertyName("expiresAt")]
  public DateTimeOffset ExpiresAt { get; init; }
  [JsonPropertyName("idempotencyKey")]
  public string IdempotencyKey { get; init; } = string.Empty;
}

public sealed record UpdateExecutionResult(
  string DeviceId,
  string DeploymentId,
  string Outcome,
  string ManifestSha256,
  string JournalHeadSha256,
  string? ActivatedArtifactSha256,
  string? ObservedVersion,
  IReadOnlyDictionary<string, object?> Health,
  string? Reason);

public sealed record UpdateProgress(
  string DeviceId,
  string DeploymentId,
  string DeliveryLeaseId,
  string ManifestSha256,
  string Status,
  string JournalHeadSha256);

public sealed record UpdateDeliveryAcknowledgement(
  string DeviceId,
  string DeploymentId,
  string DeliveryLeaseId,
  string ManifestSha256);

public sealed class UpdateDeliveryFenceException : Exception
{
  public UpdateDeliveryFenceException(string message, Exception innerException)
    : base(message, innerException) { }
}

public static class UpdateTerminalReason
{
  public const int MaximumLength = 2_000;
  public const string TruncationMarker = "...[truncated]";

  public static string? Normalize(string? value)
  {
    if (string.IsNullOrWhiteSpace(value)) return null;

    var sanitized = new StringBuilder(Math.Min(value.Length, MaximumLength));
    var pendingSpace = false;
    foreach (var rune in value.EnumerateRunes())
    {
      var category = Rune.GetUnicodeCategory(rune);
      var replaceWithSpace = category is
        UnicodeCategory.Control or
        UnicodeCategory.Format or
        UnicodeCategory.LineSeparator or
        UnicodeCategory.ParagraphSeparator or
        UnicodeCategory.SpaceSeparator;
      if (replaceWithSpace)
      {
        pendingSpace = sanitized.Length > 0;
        continue;
      }
      if (pendingSpace)
      {
        sanitized.Append(' ');
        pendingSpace = false;
      }
      sanitized.Append(rune.ToString());
    }

    var result = sanitized.ToString();
    if (result.Length == 0) return null;
    if (result.Length <= MaximumLength) return result;

    var prefixLength = MaximumLength - TruncationMarker.Length;
    if (prefixLength > 0 && char.IsHighSurrogate(result[prefixLength - 1]))
      prefixLength--;
    return result[..prefixLength] + TruncationMarker;
  }
}
