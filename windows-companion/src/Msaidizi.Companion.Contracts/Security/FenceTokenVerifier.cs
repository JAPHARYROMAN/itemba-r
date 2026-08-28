using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Itemba.Msaidizi.Companion.Contracts.Commands;

namespace Itemba.Msaidizi.Companion.Contracts.Security;

public sealed record FenceTokenClaims
{
  [JsonPropertyName("iss")]
  public required string Issuer { get; init; }

  [JsonPropertyName("aud")]
  public required string Audience { get; init; }

  [JsonPropertyName("sub")]
  public required string Subject { get; init; }

  [JsonPropertyName("jti")]
  public required string TokenId { get; init; }

  [JsonPropertyName("command_type")]
  public required string CommandType { get; init; }

  [JsonPropertyName("fence_id")]
  public required string FenceId { get; init; }

  [JsonPropertyName("device_id")]
  public required string DeviceId { get; init; }

  [JsonPropertyName("action_id")]
  public required string ActionId { get; init; }

  [JsonPropertyName("task_id")]
  public required string TaskId { get; init; }

  [JsonPropertyName("step_id")]
  public required string StepId { get; init; }

  [JsonPropertyName("old_lease_id")]
  public required string OldLeaseId { get; init; }

  [JsonPropertyName("old_fencing_token")]
  public required string OldFencingToken { get; init; }

  [JsonPropertyName("old_action_token_sha256")]
  public required string OldActionTokenSha256 { get; init; }

  [JsonPropertyName("journal_previous_sequence")]
  public long JournalPreviousSequence { get; init; }

  [JsonPropertyName("journal_previous_hash")]
  public required string JournalPreviousHash { get; init; }

  [JsonPropertyName("dispatch_count")]
  public int DispatchCount { get; init; }

  [JsonPropertyName("iat")]
  public long IssuedAtUnixSeconds { get; init; }

  [JsonPropertyName("exp")]
  public long ExpiresAtUnixSeconds { get; init; }
}

public sealed record FenceTokenVerificationResult(
  bool IsValid,
  FenceTokenClaims? Claims,
  string? ErrorCode)
{
  public static FenceTokenVerificationResult Valid(FenceTokenClaims claims) =>
    new(true, claims, null);

  public static FenceTokenVerificationResult Invalid(string errorCode) =>
    new(false, null, errorCode);
}

public interface IFenceTokenVerifier
{
  ValueTask<FenceTokenVerificationResult> VerifyAsync(
    string compactToken,
    CancellationToken cancellationToken);
}

/// <summary>
/// Strict verifier for short-lived broker-issued fence+jwt control tokens.
/// Fence tokens share the enrolled action-signing key but have a distinct type
/// and closed claim set, so they can never be interpreted as execution tokens.
/// </summary>
public sealed class Es256FenceTokenVerifier : IFenceTokenVerifier
{
  private static readonly JsonSerializerOptions SerializerOptions =
    new(JsonSerializerDefaults.Web);
  private static readonly HashSet<string> RequiredHeaderProperties = new(StringComparer.Ordinal)
  {
    "alg",
    "kid",
    "typ",
  };
  private static readonly HashSet<string> RequiredClaimProperties = new(StringComparer.Ordinal)
  {
    "iss",
    "aud",
    "sub",
    "jti",
    "command_type",
    "fence_id",
    "device_id",
    "action_id",
    "task_id",
    "step_id",
    "old_lease_id",
    "old_fencing_token",
    "old_action_token_sha256",
    "journal_previous_sequence",
    "journal_previous_hash",
    "dispatch_count",
    "iat",
    "exp",
  };

  private readonly ActionTokenVerificationSettings _settings;
  private readonly IActionVerificationKeyResolver _keyResolver;
  private readonly TimeProvider _timeProvider;

  public Es256FenceTokenVerifier(
    ActionTokenVerificationSettings settings,
    IActionVerificationKeyResolver keyResolver,
    TimeProvider? timeProvider = null)
  {
    _settings = settings;
    _keyResolver = keyResolver;
    _timeProvider = timeProvider ?? TimeProvider.System;
  }

  public ValueTask<FenceTokenVerificationResult> VerifyAsync(
    string compactToken,
    CancellationToken cancellationToken)
  {
    cancellationToken.ThrowIfCancellationRequested();
    if (string.IsNullOrWhiteSpace(compactToken) || compactToken.Length > 16_384)
    {
      return ValueTask.FromResult(FenceTokenVerificationResult.Invalid("fence_token_malformed"));
    }

    var segments = compactToken.Split('.');
    if (segments.Length != 3 || segments.Any(string.IsNullOrEmpty))
    {
      return ValueTask.FromResult(FenceTokenVerificationResult.Invalid("fence_token_malformed"));
    }

    try
    {
      var headerBytes = Base64Url.Decode(segments[0]);
      var payloadBytes = Base64Url.Decode(segments[1]);
      var signature = Base64Url.Decode(segments[2]);
      using var headerDocument = JsonDocument.Parse(headerBytes);
      if (!HasExactUniqueProperties(headerDocument.RootElement, RequiredHeaderProperties)
        || headerDocument.RootElement.GetProperty("alg").GetString() != "ES256"
        || headerDocument.RootElement.GetProperty("typ").GetString() != "fence+jwt")
      {
        return ValueTask.FromResult(FenceTokenVerificationResult.Invalid(
          "fence_token_header_invalid"));
      }

      var keyId = headerDocument.RootElement.GetProperty("kid").GetString();
      if (!CompanionWireContract.IsSafeIdentifier(keyId)
        || !_keyResolver.TryResolve(keyId!, out var publicKey)
        || publicKey is null)
      {
        return ValueTask.FromResult(FenceTokenVerificationResult.Invalid(
          "fence_token_key_untrusted"));
      }

      using (publicKey)
      {
        var signedBytes = Encoding.ASCII.GetBytes($"{segments[0]}.{segments[1]}");
        if (publicKey.KeySize != 256
          || signature.Length != 64
          || !publicKey.VerifyData(
            signedBytes,
            signature,
            HashAlgorithmName.SHA256,
            DSASignatureFormat.IeeeP1363FixedFieldConcatenation))
        {
          return ValueTask.FromResult(FenceTokenVerificationResult.Invalid(
            "fence_token_signature_invalid"));
        }
      }

      using var claimsDocument = JsonDocument.Parse(payloadBytes);
      if (!HasExactUniqueProperties(claimsDocument.RootElement, RequiredClaimProperties))
      {
        return ValueTask.FromResult(FenceTokenVerificationResult.Invalid(
          "fence_token_claims_not_strict"));
      }

      var claims = claimsDocument.RootElement.Deserialize<FenceTokenClaims>(SerializerOptions);
      if (claims is null || !ClaimsAreCanonical(claims))
      {
        return ValueTask.FromResult(FenceTokenVerificationResult.Invalid(
          "fence_token_claims_invalid"));
      }
      if (!string.Equals(claims.Issuer, _settings.ExpectedIssuer, StringComparison.Ordinal)
        || !string.Equals(claims.Audience, _settings.ExpectedAudience, StringComparison.Ordinal)
        || !string.Equals(claims.Subject, _settings.ExpectedSubject, StringComparison.Ordinal))
      {
        return ValueTask.FromResult(FenceTokenVerificationResult.Invalid(
          "fence_token_scope_invalid"));
      }

      var issuedAt = DateTimeOffset.FromUnixTimeSeconds(claims.IssuedAtUnixSeconds);
      var expiresAt = DateTimeOffset.FromUnixTimeSeconds(claims.ExpiresAtUnixSeconds);
      var now = _timeProvider.GetUtcNow();
      if (expiresAt <= issuedAt
        || expiresAt - issuedAt > _settings.MaximumTokenLifetime
        || issuedAt > now + _settings.AllowedClockSkew
        || expiresAt <= now - _settings.AllowedClockSkew)
      {
        return ValueTask.FromResult(FenceTokenVerificationResult.Invalid(
          "fence_token_time_invalid"));
      }

      return ValueTask.FromResult(FenceTokenVerificationResult.Valid(claims));
    }
    catch (Exception exception) when (exception is FormatException
      or JsonException
      or ArgumentOutOfRangeException
      or InvalidOperationException
      or UnauthorizedAccessException
      or IOException
      or CryptographicException)
    {
      return ValueTask.FromResult(FenceTokenVerificationResult.Invalid("fence_token_malformed"));
    }
  }

  private static bool ClaimsAreCanonical(FenceTokenClaims claims) =>
    string.Equals(claims.CommandType, "FENCE_ACTION", StringComparison.Ordinal)
    && string.Equals(claims.TokenId, claims.FenceId, StringComparison.Ordinal)
    && FenceActionWireContract.IsSafeIdentifier(claims.FenceId)
    && FenceActionWireContract.IsSafeIdentifier(claims.DeviceId)
    && FenceActionWireContract.IsSafeIdentifier(claims.ActionId)
    && FenceActionWireContract.IsSafeIdentifier(claims.TaskId)
    && FenceActionWireContract.IsSafeIdentifier(claims.StepId)
    && LeaseFenceContract.HasValidIdentity(claims.OldLeaseId, claims.OldFencingToken)
    && PayloadDigest.IsSha256Hex(claims.OldActionTokenSha256)
    && claims.JournalPreviousSequence >= 0
    && PayloadDigest.IsSha256Hex(claims.JournalPreviousHash)
    && claims.DispatchCount is >= 1 and <= 3;

  private static bool HasExactUniqueProperties(
    JsonElement element,
    HashSet<string> required)
  {
    if (element.ValueKind != JsonValueKind.Object)
    {
      return false;
    }

    var seen = new HashSet<string>(StringComparer.Ordinal);
    foreach (var property in element.EnumerateObject())
    {
      if (!required.Contains(property.Name) || !seen.Add(property.Name))
      {
        return false;
      }
    }
    return seen.Count == required.Count;
  }
}

public static class FenceActionRequestAuthorizer
{
  public static string? Validate(
    FenceActionRequest request,
    FenceTokenClaims claims,
    DateTimeOffset? nowUtc = null)
  {
    if (!FenceActionWireContract.IsSafeIdentifier(request.FenceId)
      || !FenceActionWireContract.IsSafeIdentifier(request.DeviceId)
      || !FenceActionWireContract.IsSafeIdentifier(request.ActionId)
      || !FenceActionWireContract.IsSafeIdentifier(request.TaskId)
      || !FenceActionWireContract.IsSafeIdentifier(request.StepId)
      || !LeaseFenceContract.HasValidIdentity(request.OldLeaseId, request.OldFencingToken)
      || !PayloadDigest.IsSha256Hex(request.OldActionTokenSha256)
      || request.JournalPreviousSequence < 0
      || !PayloadDigest.IsSha256Hex(request.JournalPreviousHash)
      || request.DispatchCount is < 1 or > 3
      || request.ExpiresAt <= (nowUtc ?? DateTimeOffset.UtcNow))
    {
      return "fence_request_invalid";
    }

    if (!string.Equals(request.FenceId, claims.FenceId, StringComparison.Ordinal)
      || !string.Equals(request.DeviceId, claims.DeviceId, StringComparison.Ordinal)
      || !string.Equals(request.ActionId, claims.ActionId, StringComparison.Ordinal)
      || !string.Equals(request.TaskId, claims.TaskId, StringComparison.Ordinal)
      || !string.Equals(request.StepId, claims.StepId, StringComparison.Ordinal)
      || !string.Equals(request.OldLeaseId, claims.OldLeaseId, StringComparison.Ordinal)
      || !string.Equals(request.OldFencingToken, claims.OldFencingToken, StringComparison.Ordinal)
      || !PayloadDigest.FixedTimeEqualsHex(
        request.OldActionTokenSha256,
        claims.OldActionTokenSha256)
      || request.JournalPreviousSequence != claims.JournalPreviousSequence
      || !PayloadDigest.FixedTimeEqualsHex(
        request.JournalPreviousHash,
        claims.JournalPreviousHash)
      || request.DispatchCount != claims.DispatchCount
      || request.ExpiresAt.ToUnixTimeSeconds() != claims.ExpiresAtUnixSeconds)
    {
      return "fence_claim_mismatch";
    }

    return null;
  }
}

public static class FenceActionWireContract
{
  public static bool IsSafeIdentifier(string? value) =>
    value is { Length: >= 1 and <= 160 }
    && char.IsAsciiLetterOrDigit(value[0])
    && value.All(character => char.IsAsciiLetterOrDigit(character)
      || character is '.' or '_' or ':' or '-');
}
