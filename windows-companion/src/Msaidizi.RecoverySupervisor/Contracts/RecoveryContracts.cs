using System.Text.Json.Serialization;

namespace Itemba.Msaidizi.RecoverySupervisor.Contracts;

public sealed record SignedRecoveryCommand(
  string RecoveryId,
  string ManifestJson,
  string ManifestSha256,
  string Signature,
  string SigningKeyId);

public sealed class TrustedRecoveryManifest
{
  [JsonPropertyName("schemaVersion")]
  public int SchemaVersion { get; init; }
  [JsonPropertyName("recoveryId")]
  public string RecoveryId { get; init; } = string.Empty;
  [JsonPropertyName("deviceId")]
  public string DeviceId { get; init; } = string.Empty;
  [JsonPropertyName("originalActionId")]
  public string OriginalActionId { get; init; } = string.Empty;
  [JsonPropertyName("recoveryRecordSha256")]
  public string RecoveryRecordSha256 { get; init; } = string.Empty;
  [JsonPropertyName("expectedCurrentStateSha256")]
  public string ExpectedCurrentStateSha256 { get; init; } = string.Empty;
  [JsonPropertyName("expectedRestoredStateSha256")]
  public string ExpectedRestoredStateSha256 { get; init; } = string.Empty;
  [JsonPropertyName("idempotencyKey")]
  public string IdempotencyKey { get; init; } = string.Empty;
  [JsonPropertyName("issuedAt")]
  public DateTimeOffset IssuedAt { get; init; }
  [JsonPropertyName("expiresAt")]
  public DateTimeOffset ExpiresAt { get; init; }
}

public sealed record RecoveryExecutionResult(
  string DeviceId,
  string RecoveryId,
  string Outcome,
  string ManifestSha256,
  string JournalHeadSha256,
  string? RestoredStateSha256,
  string? Reason);

public sealed record RecoveryProgress(
  string DeviceId,
  string RecoveryId,
  string JournalHeadSha256);
